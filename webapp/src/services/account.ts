import { create } from 'zustand'
import { setApiKey, useSettings } from './settings.js'

/** DeepSeek 账号登录状态（登录后自动使用账号的 API Key） */
type AccountState = {
  loggedIn: boolean
  name: string
  avatar: string
  /** 登录态下从官方账号拿到的 key */
  key: string | null
}

export const useAccount = create<AccountState>(() => ({
  loggedIn: false,
  name: '',
  avatar: '',
  key: null,
}))

/** 登录前用户手动填的 key，退出登录时恢复 */
const MANUAL_KEY = 'chat-demo:manual-api-key'

type NativeAccountBridge = {
  getAccount?: () => string
  openDeepSeekLogin?: () => void
  logoutAccount?: () => void
}

const native = (): NativeAccountBridge | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { DeepSeekAndroid?: NativeAccountBridge }).DeepSeekAndroid

/** 启动时读取原生保存的登录态；登录的 key 优先于手动填的 key */
export const loadAccount = () => {
  const json = native()?.getAccount?.()
  if (!json) {
    return
  }
  try {
    const saved = JSON.parse(json) as { key?: string; name?: string; avatar?: string }
    if (!saved.key) {
      return
    }
    const current = useSettings.getState().apiKey
    if (current && current !== saved.key && !localStorage.getItem(MANUAL_KEY)) {
      localStorage.setItem(MANUAL_KEY, current)
    }
    useAccount.setState({
      loggedIn: true,
      name: saved.name || 'DeepSeek 用户',
      avatar: saved.avatar || '',
      key: saved.key,
    })
    setApiKey(saved.key)
  } catch {
    // 解析失败忽略
  }
}

/** 打开官方登录页（原生内嵌 WebView） */
export const startLogin = () => {
  const current = useSettings.getState().apiKey
  if (current && !localStorage.getItem(MANUAL_KEY) && !useAccount.getState().loggedIn) {
    localStorage.setItem(MANUAL_KEY, current)
  }
  native()?.openDeepSeekLogin?.()
}

/** 退出登录：恢复手动 key */
export const logoutAccount = () => {
  native()?.logoutAccount?.()
  const manual = localStorage.getItem(MANUAL_KEY)
  setApiKey(manual || null)
  useAccount.setState({ loggedIn: false, name: '', avatar: '', key: null })
}

/** 原生登录 WebView 回调到页面 */
if (typeof window !== 'undefined') {
  ;(
    window as Window & {
      __deeplookAccount?: {
        onKey: (key: string) => void
        onProfile: (name: string, avatar: string) => void
        onLogout: () => void
      }
    }
  ).__deeplookAccount = {
    onKey: (key: string) => {
      if (!key) {
        return
      }
      useAccount.setState({ loggedIn: true, key })
      setApiKey(key)
    },
    onProfile: (name: string, avatar: string) => {
      useAccount.setState((state) => ({
        name: name || state.name,
        avatar: avatar || state.avatar,
      }))
    },
    onLogout: () => {
      useAccount.setState({ loggedIn: false, name: '', avatar: '', key: null })
    },
  }
}
