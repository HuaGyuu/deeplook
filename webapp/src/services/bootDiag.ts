/**
 * 启动诊断（只在调试版里被原生层读取）：把「脚本是否执行、React 是否挂载、
 * 页面里有没有内容、遇到过什么 JS 错误」记录到 window.__deeplookDiag，
 * 原生层每秒取一次显示在屏幕上，黑屏时也能看到卡在哪一步。
 *
 * 这个模块必须在入口最前面 import：它先于其它模块执行，才能捕获后续模块的报错。
 */
type BootDiagState = {
  startedAt: number
  mounted: boolean
  ready: boolean
  errors: string[]
  notes: string[]
  idb: string
  features: string
}

const state: BootDiagState = {
  startedAt: Date.now(),
  mounted: false,
  ready: false,
  errors: [],
  notes: [],
  idb: 'pending',
  features: '',
}

const push = (list: string[], text: string) => {
  list.push(String(text).replace(/\s+/g, ' ').slice(0, 180))
  if (list.length > 5) {
    list.splice(0, list.length - 5)
  }
}

const describe = (value: unknown): string => {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 老版本 WebView 缺少这些 API 时，打包后的脚本可能直接跑不起来 */
const probeFeatures = () => {
  const missing: string[] = []
  if (typeof (Array.prototype as { at?: unknown }).at !== 'function') {
    missing.push('Array.at')
  }
  if (typeof structuredClone !== 'function') {
    missing.push('structuredClone')
  }
  if (typeof Object.hasOwn !== 'function') {
    missing.push('Object.hasOwn')
  }
  if (typeof (Promise as { any?: unknown }).any !== 'function') {
    missing.push('Promise.any')
  }
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    missing.push('randomUUID')
  }
  if (typeof queueMicrotask !== 'function') {
    missing.push('queueMicrotask')
  }
  state.features = missing.length > 0 ? missing.join(',') : 'ok'
}

const probeStorage = () => {
  try {
    localStorage.setItem('__deeplook_diag', '1')
    localStorage.removeItem('__deeplook_diag')
    push(state.notes, 'ls=ok')
  } catch (error) {
    push(state.notes, `ls=fail ${describe(error)}`)
  }
  try {
    const open = indexedDB.open('__deeplook_diag', 1)
    open.onsuccess = () => {
      state.idb = 'ok'
      open.result.close()
      indexedDB.deleteDatabase('__deeplook_diag')
    }
    open.onerror = () => {
      state.idb = `fail ${describe(open.error)}`
    }
    open.onblocked = () => {
      state.idb = 'blocked'
    }
  } catch (error) {
    state.idb = `throw ${describe(error)}`
  }
}

export const markMounted = () => {
  state.mounted = true
}

export const noteBoot = (text: string) => push(state.notes, text)

export const noteReady = (ready: boolean) => {
  state.ready = ready
}

/** 元素在视口里的位置尺寸，用来发现「有内容但被挪出屏幕 / 尺寸为 0」 */
const rectOf = (el: HTMLElement | null) => {
  if (!el) {
    return 'none'
  }
  const rect = el.getBoundingClientRect()
  return `${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.left)},${Math.round(rect.top)}`
}

/** 关键节点的计算样式：区分「DOM 有内容但不可见」和「页面根本没绘制」 */
const cssInfo = () => {
  const body = document.body
  const root = document.getElementById('root')
  const first = root?.firstElementChild as HTMLElement | null
  const bodyStyle = body ? getComputedStyle(body) : null
  const firstStyle = first ? getComputedStyle(first) : null
  const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
  let running = -1
  try {
    running = document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : -1
  } catch {
    running = -2
  }
  return [
    `bg=${bodyStyle?.backgroundColor ?? '?'}`,
    `fg=${bodyStyle?.color ?? '?'}`,
    `op=${firstStyle?.opacity ?? '?'}`,
    `vis=${firstStyle?.visibility ?? '?'}`,
    `anim=${running}`,
    `rm=${window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0}`,
    `dark=${window.matchMedia('(prefers-color-scheme: dark)').matches ? 1 : 0}`,
    `hit=${center ? `${center.tagName}.${String(center.className || '').slice(0, 18)}` : 'none'}`,
    `vw=${window.innerWidth}x${window.innerHeight}`,
    `dpr=${window.devicePixelRatio}`,
    `doc=${document.visibilityState}`,
    `rect=${rectOf(first)}`,
    `htmlbg=${getComputedStyle(document.documentElement).backgroundColor}`,
    `scrim=${document.documentElement.style.getPropertyValue('--chat-bg-scrim-alpha') || '-'}`,
    `surface=${document.documentElement.style.getPropertyValue('--chat-surface') || '-'}`,
    `bgLayer=${document.querySelector('[class*="chatBackground"]') ? 1 : 0}`,
  ].join(' ')
}

/** 红屏自检：铺一层纯红，用来判断 WebView 到底有没有把内容画到屏幕上 */
export const redTest = (on: boolean) => {
  const id = '__deeplook_red_test'
  const existing = document.getElementById(id)
  if (!on) {
    existing?.remove()
    return 'off'
  }
  if (existing) {
    return 'on'
  }
  const layer = document.createElement('div')
  layer.id = id
  layer.setAttribute(
    'style',
    'position:fixed!important;inset:0!important;z-index:2147483647!important;background:#ff0000!important;'
  )
  document.documentElement.appendChild(layer)
  return 'on'
}

const report = () => {
  const root = document.getElementById('root')
  return [
    `t=${Date.now() - state.startedAt}`,
    `mount=${state.mounted ? 1 : 0}`,
    `ready=${state.ready ? 1 : 0}`,
    `root=${root ? root.childElementCount : -1}`,
    `html=${document.documentElement.innerHTML.length}`,
    `idb=${state.idb}`,
    `feat=${state.features}`,
    `err=${state.errors.length > 0 ? state.errors.join(' | ') : 'none'}`,
    `note=${state.notes.length > 0 ? state.notes.join(' | ') : 'none'}`,
    cssInfo(),
  ].join(' ')
}

declare global {
  interface Window {
    __deeplookDiag?: boolean
    __deeplookDiagReport?: () => string
    __deeplookRedTest?: (on: boolean) => string
  }
}

// 页面里最早的钩子：脚本执行到这里，说明 bundle 本身跑起来了
window.__deeplookDiag = true
window.__deeplookDiagReport = report
window.__deeplookRedTest = redTest

window.addEventListener('error', (event) => {
  push(state.errors, `${event.message} @${event.filename}:${event.lineno}`)
})
window.addEventListener('unhandledrejection', (event) => {
  push(state.errors, `rejection ${describe(event.reason)}`)
})

probeFeatures()
probeStorage()
