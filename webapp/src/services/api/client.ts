import { translate, type TranslationMessage } from '../../i18n/index.js'
import { getConnection, PROTOCOL_OPENAI } from '../providers.js'
import { streamOpenAiMessage } from './openai.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

/**
 * Anthropic 兼容接口的基地址。
 * 自定义服务商时用其配置的接口地址；地址里已带 /v1 或 /anthropic 时不再重复拼接。
 */
const anthropicBaseUrl = (endpoint: string): string => {
  if (!endpoint) {
    return `${API_ORIGIN}/anthropic/v1`
  }
  if (/\/anthropic\/v\d+$/.test(endpoint)) {
    return endpoint
  }
  if (endpoint.endsWith('/anthropic')) {
    return `${endpoint}/v1`
  }
  if (/\/v\d+$/.test(endpoint)) {
    return endpoint
  }
  return `${endpoint}/v1`
}

/** 自定义服务商的根地址（OpenAI 兼容接口用）；空地址回落到构建期的官方地址 */
const openAiBaseUrl = (endpoint: string): string => {
  const value = endpoint || API_ORIGIN
  // OpenAI 官方与多数兼容服务以 /v1 结尾；已经带版本段时按原样使用
  return /\/v\d+\w*$/.test(value) ? value : `${value}/v1`
}

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

export const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/**
 * DeepSeek / Anthropic 兼容协议的模型列表地址。
 * 官方接口是根路径 /models（默认 DeepSeek：https://api.deepseek.com/models），
 * 自定义网关如果带了 /anthropic(/v1) 前缀则先去掉，再拼 /models。
 */
const deepSeekModelsUrl = (endpoint: string): string => {
  if (!endpoint) {
    return `${API_ORIGIN}/models`
  }
  const base = endpoint.replace(/\/anthropic(\/v\d+)?$/, '').replace(/\/+$/, '')
  return `${base}/models`
}

/** 用 GET /models 校验 API Key（不产生费用）：按当前协议选鉴权头与地址 */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const connection = getConnection()
  const isOpenAi = connection.protocol === PROTOCOL_OPENAI
  const url = isOpenAi
    ? `${openAiBaseUrl(connection.endpoint)}/models`
    : deepSeekModelsUrl(connection.endpoint)
  await request(url, {
    method: 'GET',
    headers: isOpenAi
      ? { Authorization: `Bearer ${apiKey}` }
      : {
          // 官方 DeepSeek 用 Bearer；兼容 Anthropic 的网关用 x-api-key，两个都带上以覆盖两种情况
          Authorization: `Bearer ${apiKey}`,
          ...(connection.endpoint ? { 'x-api-key': apiKey } : {}),
        },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 * Files API 只在 DeepSeek 原生协议下可用，自定义模型暂不支持附件。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const connection = getConnection()
  if (!connection.isDeepSeek) {
    throw new ApiError('http', { key: 'customModelNoAttachments' })
  }
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${anthropicBaseUrl(connection.endpoint)}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  const connection = getConnection()
  if (!connection.isDeepSeek) {
    // 自定义模型没有可删除的远端文件
    return
  }
  await request(`${anthropicBaseUrl(connection.endpoint)}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * 发出一条聊天请求，逐个产出内部协议事件：
 * - DeepSeek 原生协议：POST {origin}/anthropic/v1/messages（stream: true），收到 message_stop 时结束；
 * - OpenAI 兼容协议：交给 openai.ts 适配层，把分片翻译成同样的内部事件。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const connection = getConnection()
  if (connection.protocol === PROTOCOL_OPENAI) {
    yield* streamOpenAiMessage(
      openAiBaseUrl(connection.endpoint),
      apiKey,
      body,
      connection.model,
      signal
    )
    return
  }
  const response = await request(`${anthropicBaseUrl(connection.endpoint)}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, model: connection.model, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
