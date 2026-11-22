import { create } from 'zustand'

/**
 * AI 人设：可保存多套（名称 + 内容 + 可选封面）。
 * 新建对话时选一个，注入到该会话的系统提示里；会话里存的是快照，
 * 之后改人设或删人设都不会影响已有对话。
 */
export type Persona = {
  id: string
  name: string
  content: string
  /** 相册封面（压缩后的 data URL）；null 表示用名字做封面 */
  cover: string | null
  createdAt: number
}

type PersonaState = {
  personas: Persona[]
  /** 新建对话默认选中的人设 */
  selectedId: string | null
}

const STORE_KEY = 'deeplook-personas'
/** 旧版本的单一 AI 人设，首次启动时迁移成第一条人设 */
const LEGACY_AI_KEY = 'chat-demo:ai-persona'

const createId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

const asPersona = (value: unknown): Persona | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const item = value as Partial<Persona>
  if (typeof item.id !== 'string' || typeof item.name !== 'string') {
    return null
  }
  return {
    id: item.id,
    name: item.name,
    content: typeof item.content === 'string' ? item.content : '',
    cover: typeof item.cover === 'string' && item.cover ? item.cover : null,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
  }
}

const load = (): PersonaState => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { personas?: unknown; selectedId?: unknown }
      const personas = Array.isArray(parsed.personas)
        ? parsed.personas.map(asPersona).filter((item): item is Persona => item !== null)
        : []
      const selectedId =
        typeof parsed.selectedId === 'string' && personas.some((item) => item.id === parsed.selectedId)
          ? parsed.selectedId
          : null
      return { personas, selectedId }
    }
    const legacy = localStorage.getItem(LEGACY_AI_KEY)?.trim()
    if (legacy) {
      const persona: Persona = {
        id: createId(),
        name: '我的 AI 人设',
        content: legacy,
        cover: null,
        createdAt: Date.now(),
      }
      return { personas: [persona], selectedId: persona.id }
    }
  } catch {
    // 读取失败时从空列表开始，不影响其它功能
  }
  return { personas: [], selectedId: null }
}

const persist = (state: PersonaState) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    // 配额不足时保持内存态可用
  }
}

export const usePersonas = create<PersonaState>(() => load())

const commit = (next: PersonaState) => {
  usePersonas.setState(next)
  persist(next)
}

export const addPersona = (name: string, content: string, cover: string | null): string => {
  const state = usePersonas.getState()
  const persona: Persona = {
    id: createId(),
    name: name.trim() || '新人设',
    content,
    cover,
    createdAt: Date.now(),
  }
  commit({
    personas: [persona, ...state.personas],
    // 新建后默认选中它，方便新对话直接用
    selectedId: persona.id,
  })
  return persona.id
}

export const updatePersona = (id: string, patch: Partial<Pick<Persona, 'name' | 'content' | 'cover'>>) => {
  const state = usePersonas.getState()
  commit({
    ...state,
    personas: state.personas.map((item) =>
      item.id === id
        ? {
            ...item,
            ...patch,
            name: patch.name === undefined ? item.name : patch.name.trim() || '未命名人设',
          }
        : item
    ),
  })
}

export const deletePersona = (id: string) => {
  const state = usePersonas.getState()
  const personas = state.personas.filter((item) => item.id !== id)
  commit({
    personas,
    selectedId: state.selectedId === id ? (personas[0]?.id ?? null) : state.selectedId,
  })
}

export const selectPersona = (id: string | null) => {
  const state = usePersonas.getState()
  if (id !== null && !state.personas.some((item) => item.id === id)) {
    return
  }
  commit({ ...state, selectedId: id })
}

export const getSelectedPersona = (): Persona | null => {
  const state = usePersonas.getState()
  return state.personas.find((item) => item.id === state.selectedId) ?? null
}
