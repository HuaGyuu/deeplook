import { APP_VERSION } from './appVersion.js'

const REPOSITORY = 'HuaGyuu/deeplook'
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`

export type LatestRelease = {
  version: string
  url: string
  htmlUrl: string
  body: string
}

export type UpdateEvent =
  | {
      type: 'check'
      ok: boolean
      body?: string
      message?: string
    }
  | {
      type: 'download'
      status: 'downloading' | 'ready' | 'permission' | 'installing' | 'error' | 'external'
      percent?: number
      message?: string
    }

type NativeUpdateBridge = {
  isPreview?: () => boolean
  checkForUpdate?: () => void
  downloadUpdate?: (url: string, version: string) => void
}

type NativeUpdateWindow = Window & {
  DeepSeekAndroid?: NativeUpdateBridge
  __deeplookUpdate?: (type: string, payload: unknown) => void
}

const listeners = new Set<(event: UpdateEvent) => void>()

const emit = (event: UpdateEvent) => {
  for (const listener of listeners) {
    listener(event)
  }
}

const subscribe = (listener: (event: UpdateEvent) => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const bridge = () => (window as NativeUpdateWindow).DeepSeekAndroid

/** 测试版（独立包名）不参与正式版更新检查 */
export const isPreviewBuild = () => {
  try {
    return Boolean(bridge()?.isPreview?.())
  } catch {
    return false
  }
}

/** 安装原生回调；页面刷新后重新绑定。 */
const ensureNativeCallback = () => {
  const target = window as NativeUpdateWindow
  if (target.__deeplookUpdate) {
    return
  }
  target.__deeplookUpdate = (type, payload) => {
    const value = (payload ?? {}) as {
      ok?: boolean
      body?: string
      message?: string
      status?: string
      percent?: number
    }
    if (type === 'check') {
      emit({
        type: 'check',
        ok: value.ok === true,
        body: value.body,
        message: value.message,
      })
    } else if (type === 'download') {
      emit({
        type: 'download',
        status: value.status as 'downloading' | 'ready' | 'permission' | 'installing' | 'error',
        percent: value.percent,
        message: value.message,
      })
    }
  }
}

export const normalizeVersion = (tag: string) => tag.trim().replace(/^v/i, '')

export const isNewerVersion = (latest: string, current = APP_VERSION) => {
  const left = normalizeVersion(latest).split('.').map((part) => Number(part) || 0)
  const right = normalizeVersion(current).split('.').map((part) => Number(part) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) {
      return a > b
    }
  }
  return false
}

const parseRelease = (data: {
  tag_name?: string
  html_url?: string
  body?: string
  assets?: { name?: string; browser_download_url?: string }[]
}): LatestRelease => {
  const version = normalizeVersion(data.tag_name ?? '')
  // 同一 Release 里有正式版和 -diag 调试版两个 APK，自动更新只能挑正式版
  const apks = (data.assets ?? []).filter((asset) => /\.apk$/i.test(asset.name ?? ''))
  const apk = apks.find((asset) => !/-diag\.apk$/i.test(asset.name ?? '')) ?? apks[0]
  const htmlUrl = data.html_url ?? `https://github.com/${REPOSITORY}/releases`
  return {
    version,
    url: apk?.browser_download_url ?? htmlUrl,
    htmlUrl,
    body: data.body ?? '',
  }
}

export const checkLatestRelease = async (): Promise<LatestRelease> => {
  ensureNativeCallback()
  const native = bridge()
  if (native?.checkForUpdate) {
    return new Promise((resolve, reject) => {
      let timer = 0
      const off = subscribe((event) => {
        if (event.type !== 'check') {
          return
        }
        window.clearTimeout(timer)
        off()
        if (!event.ok || !event.body) {
          reject(new Error(event.message || 'update check failed'))
          return
        }
        try {
          resolve(parseRelease(JSON.parse(event.body)))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      timer = window.setTimeout(() => {
        off()
        reject(new Error('update check timeout'))
      }, 20_000)
      try {
        native.checkForUpdate?.()
      } catch (error) {
        window.clearTimeout(timer)
        off()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`)
  }
  return parseRelease(await response.json())
}

/**
 * Android 原生下载并拉起 APK 安装器；浏览器环境退化为打开 Release 页面。
 * 返回取消订阅的函数。
 */
export const downloadAndInstall = (
  release: LatestRelease,
  onEvent?: (event: UpdateEvent) => void
) => {
  ensureNativeCallback()
  const native = bridge()
  const off = onEvent ? subscribe(onEvent) : () => {}
  if (native?.downloadUpdate) {
    native.downloadUpdate(release.url, release.version)
    return off
  }
  window.open(release.htmlUrl, '_blank', 'noopener,noreferrer')
  onEvent?.({ type: 'download', status: 'external' })
  return off
}

