import { create } from 'zustand'

/** DeepSeek 账号登录状态（DSH OAuth，令牌方式，不使用 API Key） */
type AccountState = {
  loggedIn: boolean
  name: string
  avatar: string
  contact: string
  token: string | null
  /** 登录过程中的状态文案 */
  status: string
  balance: number | null
  bonus: number | null
  currency: string
}

export const useAccount = create<AccountState>(() => ({
  loggedIn: false,
  name: '',
  avatar: '',
  contact: '',
  token: null,
  status: '',
  balance: null,
  bonus: null,
  currency: 'CNY',
}))

type NativeAccountBridge = {
  getAccount?: () => string
  startDeepSeekLogin?: () => void
  refreshAccountSummary?: () => void
  logoutAccount?: () => void
}

const native = (): NativeAccountBridge | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { DeepSeekAndroid?: NativeAccountBridge }).DeepSeekAndroid

const applyAccount = (saved: { token?: string; name?: string; avatar?: string; contact?: string }) => {
  if (!saved.token) {
    return
  }
  useAccount.setState({
    loggedIn: true,
    token: saved.token,
    name: saved.name || '',
    avatar: saved.avatar || '',
    contact: saved.contact || '',
    status: '',
  })
  native()?.refreshAccountSummary?.()
}

/** 启动时读取原生保存的登录态 */
export const loadAccount = () => {
  const json = native()?.getAccount?.()
  if (!json) {
    return
  }
  try {
    applyAccount(JSON.parse(json))
  } catch {
    // 解析失败忽略
  }
}

/** 打开系统浏览器完成 DSH 账号授权 */
export const startLogin = () => {
  useAccount.setState({ status: '正在打开浏览器…' })
  native()?.startDeepSeekLogin?.()
}

/** 退出登录（原生会顺带注销远端会话） */
export const logoutAccount = () => {
  native()?.logoutAccount?.()
  useAccount.setState({
    loggedIn: false,
    token: null,
    name: '',
    avatar: '',
    contact: '',
    status: '',
    balance: null,
    bonus: null,
  })
}

/** 原生回调 */
if (typeof window !== 'undefined') {
  ;(
    window as Window & {
      __deeplookAccount?: {
        onAccount: (saved: { token?: string; name?: string; avatar?: string; contact?: string }) => void
        onStatus: (text: string) => void
        onBalance: (summary: { balance?: number; bonus?: number; currency?: string }) => void
        onLogout: () => void
      }
    }
  ).__deeplookAccount = {
    onAccount: (saved) => applyAccount(saved || {}),
    onStatus: (text) => useAccount.setState({ status: text || '' }),
    onBalance: (summary) =>
      useAccount.setState({
        balance: typeof summary?.balance === 'number' ? summary.balance : null,
        bonus: typeof summary?.bonus === 'number' ? summary.bonus : null,
        currency: summary?.currency || 'CNY',
      }),
    onLogout: () =>
      useAccount.setState({
        loggedIn: false,
        token: null,
        name: '',
        avatar: '',
        contact: '',
        status: '',
        balance: null,
        bonus: null,
      }),
  }
}
