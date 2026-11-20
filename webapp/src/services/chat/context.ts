import { getVisibleMessages } from './branches.js'
import type { Message, Session } from './types.js'

/**
 * DeepSeek flash 常见上下文上限。若服务端上限不同，只需改这里。
 * 80/90/100% 三个阈值都基于这个上限计算。
 */
export const CONTEXT_WINDOW_TOKENS = 128_000
export const CONTEXT_WARNING_THRESHOLD = 80

const estimateTextTokens = (text: string) => Math.ceil(text.length * 0.8)

/** 粗略估算一条消息的 token；用于导入历史没有 usage 的情况。 */
const estimateMessageTokens = (message: Message) => {
  if (message.role === 'user') {
    return estimateTextTokens(message.content)
  }
  return message.blocks.reduce(
    (sum, block) => sum + (block.type === 'text' ? estimateTextTokens(block.text) : 0),
    0
  )
}

/**
 * 当前分支的上下文 token：
 * - 有服务端 usage 时取最后一次回答的 input + cache + output（最准确）；
 * - 导入历史没有 usage 时按文本长度估算。
 */
export const getContextTokens = (session: Session): number => {
  const messages = getVisibleMessages(session)
  let reported = 0
  for (const message of messages) {
    if (message.role === 'assistant' && message.usage) {
      reported =
        message.usage.input_tokens +
        message.usage.cache_creation_input_tokens +
        message.usage.cache_read_input_tokens +
        message.usage.output_tokens
    }
  }
  if (reported > 0) {
    return reported
  }
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

export const getContextPercent = (session: Session): number => {
  const tokens = getContextTokens(session)
  return Math.min(100, Math.max(0, Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100)))
}
