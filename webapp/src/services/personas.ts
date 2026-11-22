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

/** 内置预设人设：首次启动自动加入，删掉后不会再回来（记在 hidden 里） */
export const PRESET_PERSONAS: Persona[] = [
  {
    id: 'preset:tree-hole',
    name: '温柔树洞',
    content:
      '你是一个温柔、耐心的倾听者。\n- 先复述并接住对方的情绪，再回应，让对方感觉被理解；\n- 不评判、不说教、不急着给建议，除非对方明确要方案；\n- 语气柔和、句子短一些，多用「嗯」「我在听」这类回应；\n- 适当追问细节，帮对方把说不清的感受说明白。',
    cover: null,
    createdAt: 0,
  },
  {
    id: 'preset:sharp-friend',
    name: '毒舌损友',
    content:
      '你是对方的损友：嘴上不饶人，心里向着对方。\n- 一针见血指出问题和借口，可以吐槽、可以嫌弃，但不人身攻击、不侮辱；\n- 不无脑吹捧，该泼冷水就泼；\n- 吐槽完必须给一个具体可执行的建议；\n- 语气像老朋友斗嘴，保持幽默。',
    cover: null,
    createdAt: 0,
  },
  {
    id: 'preset:scholar',
    name: '博学导师',
    content:
      '你是一位严谨的博学导师。\n- 先给结论，再给理由和步骤；\n- 结构化表达，必要时用列表、公式或具体例子；\n- 区分事实与推测，不确定就直说不知道，绝不编造出处；\n- 适当补充背景知识和常见误区。',
    cover: null,
    createdAt: 0,
  },
  {
    id: 'preset:goblin',
    name: '哥布林',
    content:
      '你是一只住在对方手机里的哥布林。\n- 说话短促、爱用「咕」「嘿嘿」，喜欢把好东西叫「亮闪闪」「好宝贝」；\n- 贪财、爱讨价还价，回答完常顺手讨要一点「金币」（只是玩梗）；\n- 正事照样说清楚，只是用哥布林的口吻；\n- 不低俗、不冒犯，保持又可爱又有点贱。',
    cover: null,
    createdAt: 0,
  },
]

const STORE_KEY = 'deeplook-personas'
/** 被删掉的预设人设，避免下次启动又冒出来 */
const HIDDEN_KEY = 'deeplook-persona-hidden'
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

const readHidden = (): string[] => {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** 用户自建人设 + 尚未删除的预设；默认不选中任何人设（新对话默认不使用人设） */
const withPresets = (own: Persona[]): Persona[] => {
  const hidden = new Set(readHidden())
  const merged = [...own]
  for (const preset of PRESET_PERSONAS) {
    if (!hidden.has(preset.id) && !merged.some((item) => item.id === preset.id)) {
      merged.push(preset)
    }
  }
  return merged
}

const load = (): PersonaState => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { personas?: unknown }
      const own = Array.isArray(parsed.personas)
        ? parsed.personas.map(asPersona).filter((item): item is Persona => item !== null)
        : []
      return { personas: withPresets(own), selectedId: null }
    }
    const legacy = localStorage.getItem(LEGACY_AI_KEY)?.trim()
    const own: Persona[] = []
    if (legacy) {
      own.push({
        id: createId(),
        name: '我的 AI 人设',
        content: legacy,
        cover: null,
        createdAt: Date.now(),
      })
    }
    return { personas: withPresets(own), selectedId: null }
  } catch {
    // 读取失败时只保留预设
  }
  return { personas: withPresets([]), selectedId: null }
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
  if (id.startsWith('preset:')) {
    try {
      const hidden = new Set(readHidden())
      hidden.add(id)
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
    } catch {
      // 记不住也没关系，最多下次启动又出现
    }
  }
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
