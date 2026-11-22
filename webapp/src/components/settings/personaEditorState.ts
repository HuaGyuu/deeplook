import { create } from 'zustand'

/**
 * 人设编辑页是否打开：放在全局状态里，设置页的返回键 / 顶部返回才知道
 * 应该先退回人设列表，而不是直接退回设置首页。
 */
export const usePersonaEditor = create<{ editingId: string | 'new' | null }>(() => ({
  editingId: null,
}))

export const setPersonaEditing = (editingId: string | 'new' | null) =>
  usePersonaEditor.setState({ editingId })
