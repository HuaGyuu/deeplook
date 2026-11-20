import * as db from './db.js'
import { getVisibleMessages } from './branches.js'
import { useChatStore } from './store.js'
import type { Message, Session } from './types.js'

export type GlobalSearchHit = {
  sessionId: string
  title: string
  updatedAt: number
  snippet: string
}

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

/** 在所有会话中搜索标题和当前分支正文；按最近更新时间返回。 */
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
    let snippet = ''
    if (summary.title.toLocaleLowerCase().includes(needle)) {
      const index = summary.title.toLocaleLowerCase().indexOf(needle)
      snippet = makeSnippet(summary.title, index, text.length)
    } else {
      let session: Session | undefined = useChatStore.getState().sessionCache[summary.id]
      if (!session) {
        session = (await db.loadSession(summary.id)) as Session | undefined
      }
      if (session) {
        for (const message of getVisibleMessages(session)) {
          const content = messageText(message)
          const index = content.toLocaleLowerCase().indexOf(needle)
          if (index >= 0) {
            snippet = makeSnippet(content, index, text.length)
            break
          }
        }
      }
    }
    if (snippet) {
      hits.push({
        sessionId: summary.id,
        title: summary.title || '新对话',
        updatedAt: summary.updatedAt,
        snippet,
      })
    }
  }
  return hits
}


