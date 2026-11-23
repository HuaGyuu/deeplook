import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'
import { useAccount } from '../../services/account.js'

/** 设置页的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data'

/** 设置页：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

/** 当前设置页注册的返回处理器：二级页面时先回首页，返回 true 表示已消费 */
let backHandler: (() => boolean) | null = null

export const registerSettingsBackHandler = (handler: (() => boolean) | null) => {
  backHandler = handler
  return () => {
    if (backHandler === handler) {
      backHandler = null
    }
  }
}

export const handleSettingsBack = (): boolean => (backHandler ? backHandler() : false)

export const closeSettings = () => {
  backHandler = null
  useSettingsDialog.setState({ open: false })
}

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (useSettings.getState().apiKey) {
    return true
  }
  if (useAccount.getState().token) {
    return true
  }
  openSettings('data')
  return false
}

