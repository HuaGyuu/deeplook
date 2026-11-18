/**
 * 自定义大模型的连接信息：服务商预设 + 运行时配置（地址、模型名、协议）。
 *
 * - deepseek：DeepSeek 官方 Anthropic 兼容 Messages 接口（默认），支持深度思考、联网搜索、附件、朗读。
 * - openai：OpenAI Chat Completions 协议（兼容 OpenAI / Kimi / 智谱 / 硅基流动 / OpenRouter / Ollama 等），
 *   由 adapter 在本机转换成应用内部使用的「Anthropic 事件流」，聊天、续写、代码块等上层逻辑无需区分协议。
 *
 * 地址与模型名留空时使用预设默认值；协议可单独覆盖，便于「兼容 OpenAI 协议、但地址是自家网关」的场景。
 */
import { useSettings } from './settings.js'

/** DeepSeek 原生扩展协议（Anthropic Messages 兼容） */
export const PROTOCOL_ANTHROPIC = 'anthropic'
/** OpenAI Chat Completions 兼容协议 */
export const PROTOCOL_OPENAI = 'openai'

export type ApiProtocol = typeof PROTOCOL_ANTHROPIC | typeof PROTOCOL_OPENAI

export type ProviderId =
  | 'deepseek'
  | 'openai'
  | 'moonshot'
  | 'zhipu'
  | 'siliconflow'
  | 'openrouter'
  | 'ollama'
  | 'custom'

export type ProviderPreset = {
  id: ProviderId
  /** 预设显示名；不翻译，作为品牌名展示 */
  label: string
  /** 服务商控制台首页，设置面板里给出「获取 API Key」入口 */
  consoleUrl: string
  endpoint: string
  protocol: ApiProtocol
  /** 该服务商常用模型，选择预设时填入第一个 */
  models: string[]
  /** 是否需要 API Key（本地 Ollama 不需要） */
  requiresKey: boolean
  /** 该预设是否支持附件与朗读等 DeepSeek 专有能力 */
  note?: 'zh' | 'en'
}

export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    endpoint: '', // 留空使用构建时注入的官方地址 https://api.deepseek.com
    protocol: PROTOCOL_ANTHROPIC,
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    requiresKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    consoleUrl: 'https://platform.openai.com/api-keys',
    endpoint: 'https://api.openai.com/v1',
    protocol: PROTOCOL_OPENAI,
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
    requiresKey: true,
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    endpoint: 'https://api.moonshot.cn/v1',
    protocol: PROTOCOL_OPENAI,
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k'],
    requiresKey: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: PROTOCOL_OPENAI,
    models: ['glm-4.6', 'glm-4.5-air'],
    requiresKey: true,
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    endpoint: 'https://api.siliconflow.cn/v1',
    protocol: PROTOCOL_OPENAI,
    models: ['deepseek-ai/DeepSeek-V3.2-Exp', 'Qwen/Qwen3-235B-A22B-Instruct-2507'],
    requiresKey: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    consoleUrl: 'https://openrouter.ai/keys',
    endpoint: 'https://openrouter.ai/api/v1',
    protocol: PROTOCOL_OPENAI,
    models: ['deepseek/deepseek-chat', 'anthropic/claude-sonnet-4.5'],
    requiresKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    consoleUrl: 'https://ollama.com/download',
    endpoint: 'http://127.0.0.1:11434/v1',
    protocol: PROTOCOL_OPENAI,
    models: ['qwen3:8b', 'llama3.1:8b'],
    requiresKey: false,
  },
  {
    id: 'custom',
    label: '自定义（OpenAI 兼容）',
    consoleUrl: '',
    endpoint: '',
    protocol: PROTOCOL_OPENAI,
    models: [],
    requiresKey: true,
  },
]

/** 当前生效的模型连接 */
export type ModelConnection = {
  provider: ProviderId
  providerLabel: string
  endpoint: string
  model: string
  protocol: ApiProtocol
  apiKey: string
  /** 是否使用 DeepSeek 原生扩展协议（深度思考 / 联网搜索 / 附件 / 朗读可用） */
  isDeepSeek: boolean
}

/** 去掉首尾空白与末尾斜杠，便于拼接接口路径 */
export const normalizeEndpoint = (value: string): string => value.trim().replace(/\/+$/, '')

export const getProvider = (id: ProviderId): ProviderPreset =>
  PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0]

/** 取当前生效连接；地址与模型名留空时回退到预设默认值 */
export const getConnection = (): ModelConnection => {
  const settings = useSettings.getState()
  // 产品要求：只允许 DeepSeek 官方接口，模型固定 deepseek-flash，界面不暴露模型/地址配置。
  return {
    provider: 'deepseek',
    providerLabel: 'DeepSeek',
    endpoint: '',
    model: 'deepseek-flash',
    protocol: PROTOCOL_ANTHROPIC,
    apiKey: settings.apiKey ?? '',
    isDeepSeek: true,
  }
}

/** 设置面板显示的当前模型摘要 */
export const getModelSummary = (): string => {
  const connection = getConnection()
  return `${connection.providerLabel} · ${connection.model}`
}
