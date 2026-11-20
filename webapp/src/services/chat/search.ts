import * as db from './db.js'
import { getVisibleMessages } from './branches.js'
import { useChatStore } from './store.js'
import type { Message, Session } from './types.js'

export type GlobalSearchHit = {
  key: string
  sessionId: string
  /** 命中的消息；标题命中时为 null */
  messageId: string | null
  title: string
  updatedAt: number
  snippet: string
}

/** 单次搜索最多返回的结果数，避免超长会话把列表撑爆。 */
const MAX_HITS = 300
/** 同一条消息最多展示几个命中片段。 */
const MAX_HITS_PER_MESSAGE = 4

const messageText = (message: Message) => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

const makeSnippet = (text: string, index: number, length: number) => {
  // 用等长替换保留索引位置，避免把换行折叠后偏移匹配位置。
  const normalized = text.replace(/\s/g, ' ')
  const start = Math.max(0, index - 32)
  const end = Math.min(normalized.length, index + length + 70)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`
}

/**
 * 在所有会话中搜索标题和当前分支正文。
 * 同一个会话的每个命中消息、每条消息中的每个命中位置都会独立返回，
 * 因此结果列表可以显示多个匹配项，并带上跳转所需的 messageId。
 */
export const searchAllSessions = async (
  query: string,
  signal?: AbortSignal
): Promise<GlobalSearchHit[]> => {
  const text = query.trim()
  if (!text) {
    return []
  }
  const needle = text.toLocaleLowerCase()
  const summaries = useChatStore.getState().sessions
  const hits: GlobalSearchHit[] = []
  for (const summary of summaries) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const titleIndex = summary.title.toLocaleLowerCase().indexOf(needle)
    if (titleIndex >= 0) {
      hits.push({
        key: `${summary.id}:title`,
        sessionId: summary.id,
        messageId: null,
        title: summary.title || '新对话',
        updatedAt: summary.updatedAt,
        snippet: makeSnippet(summary.title, titleIndex, text.length),
      })
    }

    let session: Session | undefined = useChatStore.getState().sessionCache[summary.id]
    if (!session) {
      session = (await db.loadSession(summary.id)) as Session | undefined
    }
    if (!session) {
      continue
    }
    for (const message of getVisibleMessages(session)) {
      const content = messageText(message)
      const lower = content.toLocaleLowerCase()
      let from = 0
      let count = 0
      while (count < MAX_HITS_PER_MESSAGE && hits.length < MAX_HITS) {
        const index = lower.indexOf(needle, from)
        if (index < 0) {
          break
        }
        hits.push({
          key: `${summary.id}:${message.id}:${index}`,
          sessionId: summary.id,
          messageId: message.id,
          title: summary.title || '新对话',
          updatedAt: summary.updatedAt,
          snippet: makeSnippet(content, index, text.length),
        })
        count += 1
        from = index + Math.max(1, needle.length)
      }
      if (hits.length >= MAX_HITS) {
        return hits
      }
    }
  }
  return hits
}
