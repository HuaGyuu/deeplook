import { create } from 'zustand'

export type SearchTarget = {
  sessionId: string
  messageId: string | null
}

type GlobalSearchState = {
  open: boolean
  target: SearchTarget | null
}

export const useGlobalSearch = create<GlobalSearchState>(() => ({ open: false, target: null }))

export const openGlobalSearch = () => useGlobalSearch.setState({ open: true })
export const closeGlobalSearch = () => useGlobalSearch.setState({ open: false })

export const setSearchTarget = (target: SearchTarget) =>
  useGlobalSearch.setState({ target })

export const clearSearchTarget = () =>
  useGlobalSearch.setState({ target: null })
