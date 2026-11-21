/**
 * OpenAI Chat Completions 兼容层：把应用内部的请求体转换成 OpenAI 协议请求，
 * 再把 OpenAI 的流式分片翻译回应用内部使用的 Anthropic 风格事件，
 * 使上层（chat store / 消息渲染）不需要区分服务商协议。
 */
import { ApiError, readErrorResponse, request } from './client.js'
import { readServerSentEvents } from './sse.js'
import type { CreateMessageRequest, MessageStreamEvent } from './types.js'

/** 一次请求的块索引分配：思考块与正文块各占一个下标 */
class BlockIndexes {
  private thinking = -1
  private text = -1
  private next = 0

  /** 首次出现时发 content_block_start，之后返回同一个下标 */
  ensure(kind: 'thinking' | 'text'): { index: number; started: boolean } {
    const current = kind === 'thinking' ? this.thinking : this.text
    if (current !== -1) {
      return { index: current, started: false }
    }
    const index = this.next++
    if (kind === 'thinking') {
      this.thinking = index
    } else {
      this.text = index
    }
    return { index, started: true }
  }

  update(kind: 'thinking' | 'text'): number {
    return kind === 'thinking' ? this.thinking : this.text
  }

  /** 按出现顺序关闭所有已打开的块 */
  *closes(): Generator<MessageStreamEvent> {
    if (this.thinking !== -1) {
      yield { type: 'content_block_stop', index: this.thinking }
    }
    if (this.text !== -1) {
      yield { type: 'content_block_stop', index: this.text }
    }
  }
}

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | { type: 'text'; text: string }[]
}

/** 应用内部消息 → OpenAI messages（历史思考块与工具块丢弃，只保留正文） */
const toOpenAiMessages = (body: CreateMessageRequest): OpenAiMessage[] => {
  // 没有系统提示时不下发 system 消息，避免空内容被服务端拒绝
  const messages: OpenAiMessage[] = body.system ? [{ role: 'system', content: body.system }] : []
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      // DeepSeek 专属角色，自定义模型不支持：并入下一条用户消息更贴近原意，这里直接跳过
      continue
    }
    if (message.role === 'user') {
      const text =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((block) => (block.type === 'text' ? block.text : ''))
              .filter(Boolean)
              .join('\n')
      if (text) {
        messages.push({ role: 'user', content: text })
      }
      continue
    }
    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
    if (text) {
      messages.push({ role: 'assistant', content: text })
    }
  }
  return messages
}

/** 视口里的 reasoning_content 既有 OpenAI o 系列的 reasoning，也有 DeepSeek 的 reasoning_content */
type OpenAiDelta = {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  role?: string
}

type OpenAiChunk = {
  id?: string
  model?: string
  choices?: {
    index?: number
    delta?: OpenAiDelta
    message?: OpenAiDelta
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  error?: { message?: string; type?: string; code?: string }
}

const usageOf = (usage: OpenAiChunk['usage']) => ({
  input_tokens: usage?.prompt_tokens ?? 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  output_tokens: usage?.completion_tokens ?? 0,
})

const stopReasonOf = (reason: string | null | undefined) => {
  switch (reason) {
    case 'length':
      return 'max_tokens' as const
    case 'tool_calls':
      return 'tool_use' as const
    // 内容过滤没有对应的内部结构，按正常结束处理，保留已生成的内容
    default:
      return 'end_turn' as const
  }
}

/**
 * POST {endpoint}/chat/completions（stream: true），把分片翻译成内部事件。
 * 结束时按协议补上 message_delta 与 message_stop。
 */
export async function* streamOpenAiMessage(
  endpoint: string,
  apiKey: string,
  body: CreateMessageRequest,
  model: string,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const payload = {
    model,
    messages: toOpenAiMessages(body),
    stream: true,
    stream_options: { include_usage: true },
    ...(body.thinking.type === 'enabled' ? { reasoning_effort: 'medium' } : {}),
  }
  const response = await request(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  const indexes = new BlockIndexes()
  let started = false
  let finishReason: string | null | undefined
  let usage: OpenAiChunk['usage']
  let messageId = 'openai'
  let modelName = model

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let chunk: OpenAiChunk
    try {
      chunk = JSON.parse(data) as OpenAiChunk
    } catch {
      continue
    }
    if (chunk.error) {
      throw new ApiError('stream', chunk.error.message ?? '模型服务返回错误')
    }
    if (!started) {
      started = true
      messageId = chunk.id ?? messageId
      modelName = chunk.model ?? modelName
      yield { type: 'message_start', message: { id: messageId, model: modelName } }
    }
    usage = chunk.usage ?? usage
    const choice = chunk.choices?.[0]
    const delta = choice?.delta ?? choice?.message
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason
    }
    if (!delta) {
      continue
    }
    const thinking = delta.reasoning_content ?? delta.reasoning
    if (thinking) {
      const block = indexes.ensure('thinking')
      if (block.started) {
        // signature 在 OpenAI 协议下没有对应值，留空只用于满足内部协议形状
        yield {
          type: 'content_block_start',
          index: block.index,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: block.index,
        delta: { type: 'thinking_delta', thinking },
      }
    }
    if (delta.content) {
      const block = indexes.ensure('text')
      if (block.started) {
        yield { type: 'content_block_start', index: block.index, content_block: { type: 'text', text: '' } }
      }
      yield { type: 'content_block_delta', index: block.index, delta: { type: 'text_delta', text: delta.content } }
    }
  }

  if (!started) {
    yield { type: 'message_start', message: { id: messageId, model: modelName } }
  }
  yield* indexes.closes()
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReasonOf(finishReason), stop_sequence: null },
    usage: usageOf(usage),
  }
  yield { type: 'message_stop' }
}
