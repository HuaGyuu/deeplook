import { useSettings } from '../settings.js'
import { getConnection } from '../providers.js'
import { streamMessage } from '../api/client.js'
import { getVisibleMessages } from './branches.js'
import { getContextRounds } from './reply.js'
import type { AssistantMessage, Message, Session } from './types.js'

/** 压缩摘要时最多读取的对话字符数，避免压缩请求本身超出上下文。 */
const MAX_TRANSCRIPT_CHARS = 120_000
/** 本地兜底摘要保留的最大轮数和每段字符数。 */
const LOCAL_SUMMARY_ROUNDS = 20
const LOCAL_USER_CHARS = 260
const LOCAL_REPLY_CHARS = 460

const clip = (value: string, max: number) => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const assistantText = (message: AssistantMessage) =>
  message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

const messageText = (message: Message) => {
  if (message.role === 'user') {
    return message.content
  }
  return assistantText(message)
}

const transcriptOf = (messages: Message[]) =>
  messages
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${messageText(message)}`)
    .filter((line) => line.trim().length > 2)
    .join('\n\n')

const localSummary = (messages: Message[]): string => {
  const rounds = getContextRounds(messages)
  const selected =
    rounds.length > LOCAL_SUMMARY_ROUNDS
      ? [...rounds.slice(0, 3), ...rounds.slice(-LOCAL_SUMMARY_ROUNDS)]
      : rounds
  const lines = selected.map(([user, reply], index) => {
    const gap = index > 0 && rounds.length > LOCAL_SUMMARY_ROUNDS && index === 3 ? '【较早对话已省略】\n' : ''
    return `${gap}- 用户：${clip(user.content, LOCAL_USER_CHARS)}\n  助手：${clip(assistantText(reply), LOCAL_REPLY_CHARS)}`
  })
  if (lines.length === 0) {
    return '（此前没有可提取的对话内容）'
  }
  return `【历史对话压缩摘要】\n${lines.join('\n')}`
}

const COMPRESS_SYSTEM_PROMPT = `你是对话上下文压缩器。请把用户提供的对话压缩成一份精炼、可继续对话的中文摘要。
要求：
1. 保留用户的目标、关键事实、数字、代码/文件、已做决定、未完成任务和用户偏好；
2. 保留对后续回答有用的结论与约束，不要编造；
3. 使用分点摘要，尽量控制在 800-1500 字；
4. 只输出摘要正文，不要添加寒暄或额外说明。`

/**
 * 调用当前模型压缩会话；如果模型请求失败（例如上下文已经接近或超过上限），
 * 回退到本地提取式摘要，保证压缩按钮始终可用。
 */
export const compressSession = async (session: Session): Promise<string> => {
  const messages = getVisibleMessages(session)
  const transcript = transcriptOf(messages)
  if (!transcript.trim()) {
    return localSummary(messages)
  }
  const apiKey = useSettings.getState().apiKey ?? ''
  if (apiKey) {
    const controller = new AbortController()
    try {
      const clipped =
        transcript.length > MAX_TRANSCRIPT_CHARS
          ? `${transcript.slice(0, 30_000)}\n\n【中间部分已截断】\n\n${transcript.slice(-(MAX_TRANSCRIPT_CHARS - 30_000))}`
          : transcript
      let summary = ''
      const events = streamMessage(
        apiKey,
        {
          model: getConnection().model,
          system: COMPRESS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [{ type: 'text', text: clipped }] }],
          thinking: { type: 'disabled' },
          tools: [],
          safety_check: { level: 'high' },
        },
        controller.signal
      )
      for await (const event of events) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          summary += event.delta.text
        }
      }
      if (summary.trim()) {
        return summary.trim()
      }
    } catch {
      // 上下文满、网络失败或服务端不支持压缩时，使用本地兜底摘要。
    }
  }
  return localSummary(messages)
}
