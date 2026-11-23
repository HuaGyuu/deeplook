import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import {
  PROTOCOL_ANTHROPIC,
  PROTOCOL_OPENAI,
  PROVIDERS,
  type ApiProtocol,
  type ProviderId,
} from './providers.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 本机设置，存 localStorage：API Key、模型连接（服务商预设 / 接口地址 / 模型名 / 协议）、
 * 语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态
 */
type Settings = {
  apiKey: string | null
  /** 服务商预设，决定默认地址、协议与模型名 */
  apiProvider: ProviderId
  /** 接口地址；留空时使用预设默认值 */
  apiEndpoint: string
  /** 模型名；留空时使用预设默认值 */
  apiModel: string
  /** 协议覆盖：'' 表示跟随预设 */
  apiProtocol: ApiProtocol | ''
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** AI 人设：注入到系统提示，说明“AI 应该怎么表现” */
  aiPersona: string
  /** 聊天背景图（data URL）；空串表示使用默认背景 */
  chatBackground: string
  /** 背景遮罩（发白/变暗程度）0-100，越大文字越清晰 */
  chatBackgroundScrim: number
  /** 背景缩放 100-300（%） */
  chatBackgroundScale: number
  /** 背景水平偏移（%，相对容器宽度） */
  chatBackgroundOffsetX: number
  /** 背景垂直偏移（%，相对容器高度） */
  chatBackgroundOffsetY: number
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  apiProvider: 'chat-demo:api-provider',
  apiEndpoint: 'chat-demo:api-endpoint',
  apiModel: 'chat-demo:api-model',
  apiProtocol: 'chat-demo:api-protocol',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  aiPersona: 'chat-demo:ai-persona',
  chatBackground: 'chat-demo:chat-background',
  chatBackgroundScrim: 'chat-demo:chat-bg-scrim',
  chatBackgroundScale: 'chat-demo:chat-bg-scale',
  chatBackgroundOffsetX: 'chat-demo:chat-bg-offset-x',
  chatBackgroundOffsetY: 'chat-demo:chat-bg-offset-y',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 读取数字设置并夹在区间内，缺失或非法时用默认值 */
const readNumber = (key: string, fallback: number, min: number, max: number): number => {
  const raw = read(key)
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

const isProviderId = (value: string | null): value is ProviderId =>
  value !== null && PROVIDERS.some((item) => item.id === value)

/** 旧版本只保存了 API Key，没有模型连接信息时回退到 DeepSeek 预设 */
const initialProvider = (): ProviderId => {
  const saved = read(KEYS.apiProvider)
  return isProviderId(saved) ? saved : 'deepseek'
}

const initialProtocol = (): ApiProtocol | '' => {
  const saved = read(KEYS.apiProtocol)
  return saved === PROTOCOL_ANTHROPIC || saved === PROTOCOL_OPENAI ? saved : ''
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  apiProvider: initialProvider(),
  apiEndpoint: read(KEYS.apiEndpoint) ?? '',
  apiModel: read(KEYS.apiModel) ?? '',
  apiProtocol: initialProtocol(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  aiPersona: read(KEYS.aiPersona) ?? '',
  chatBackground: read(KEYS.chatBackground) ?? '',
  chatBackgroundScrim: readNumber(KEYS.chatBackgroundScrim, 72, 0, 100),
  chatBackgroundScale: readNumber(KEYS.chatBackgroundScale, 100, 100, 300),
  chatBackgroundOffsetX: readNumber(KEYS.chatBackgroundOffsetX, 0, -100, 100),
  chatBackgroundOffsetY: readNumber(KEYS.chatBackgroundOffsetY, 0, -100, 100),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/** 一次写入整套模型连接配置，避免 localStorage 与内存多次分步更新 */
export const setModelConnection = (value: {
  apiProvider: ProviderId
  apiEndpoint: string
  apiModel: string
  apiProtocol: ApiProtocol | ''
}) => {
  write(KEYS.apiProvider, value.apiProvider)
  write(KEYS.apiEndpoint, value.apiEndpoint)
  write(KEYS.apiModel, value.apiModel)
  write(KEYS.apiProtocol, value.apiProtocol)
  useSettings.setState(value)
}

/** 人设与聊天背景：人设每次请求都会注入系统提示，背景图存 data URL */

export const setAiPersona = (aiPersona: string) => {
  write(KEYS.aiPersona, aiPersona)
  useSettings.setState({ aiPersona })
}

/** 返回是否写入成功；图片 data URL 可能超出 localStorage 配额 */
export const setChatBackground = (chatBackground: string): boolean => {
  try {
    if (chatBackground) {
      localStorage.setItem(KEYS.chatBackground, chatBackground)
    } else {
      localStorage.removeItem(KEYS.chatBackground)
    }
    useSettings.setState({ chatBackground })
    return true
  } catch {
    return false
  }
}

/** 调整背景的遮罩、缩放与位置；数值都会夹在合理区间内 */
export const setChatBackgroundAdjust = (value: {
  scrim?: number
  scale?: number
  offsetX?: number
  offsetY?: number
}) => {
  const clamp = (input: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(input)))
  const next: Partial<{
    chatBackgroundScrim: number
    chatBackgroundScale: number
    chatBackgroundOffsetX: number
    chatBackgroundOffsetY: number
  }> = {}
  if (value.scrim !== undefined) next.chatBackgroundScrim = clamp(value.scrim, 0, 100)
  if (value.scale !== undefined) next.chatBackgroundScale = clamp(value.scale, 100, 300)
  if (value.offsetX !== undefined) next.chatBackgroundOffsetX = clamp(value.offsetX, -100, 100)
  if (value.offsetY !== undefined) next.chatBackgroundOffsetY = clamp(value.offsetY, -100, 100)
  if (next.chatBackgroundScrim !== undefined) write(KEYS.chatBackgroundScrim, String(next.chatBackgroundScrim))
  if (next.chatBackgroundScale !== undefined) write(KEYS.chatBackgroundScale, String(next.chatBackgroundScale))
  if (next.chatBackgroundOffsetX !== undefined) write(KEYS.chatBackgroundOffsetX, String(next.chatBackgroundOffsetX))
  if (next.chatBackgroundOffsetY !== undefined) write(KEYS.chatBackgroundOffsetY, String(next.chatBackgroundOffsetY))
  useSettings.setState(next)
}

