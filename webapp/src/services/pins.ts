import { create } from 'zustand'

/** 置顶会话：只在本机 localStorage 保存会话 id 列表，列表展示时排在最前 */
const KEY = 'chat-demo:pinned-sessions'

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

const write = (ids: string[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // 存储不可用时只在本次会话生效
  }
}

export const usePinnedSessions = create<{ ids: string[] }>(() => ({ ids: read() }))

export const isPinnedSession = (ids: string[], id: string) => ids.includes(id)

/** 批量置顶/取消置顶；保持原有顺序，新置顶的追加到末尾 */
export const setPinnedSessions = (ids: string[], pinned: boolean) => {
  usePinnedSessions.setState((state) => {
    const next = pinned
      ? [...state.ids, ...ids.filter((id) => !state.ids.includes(id))]
      : state.ids.filter((id) => !ids.includes(id))
    write(next)
    return { ids: next }
  })
}

export const togglePinnedSession = (id: string) => {
  usePinnedSessions.setState((state) => {
    const next = state.ids.includes(id)
      ? state.ids.filter((item) => item !== id)
      : [...state.ids, id]
    write(next)
    return { ids: next }
  })
}

