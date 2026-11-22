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
  ].join(' ')
}

declare global {
  interface Window {
    __deeplookDiag?: boolean
    __deeplookDiagReport?: () => string
  }
}

// 页面里最早的钩子：脚本执行到这里，说明 bundle 本身跑起来了
window.__deeplookDiag = true
window.__deeplookDiagReport = report

window.addEventListener('error', (event) => {
  push(state.errors, `${event.message} @${event.filename}:${event.lineno}`)
})
window.addEventListener('unhandledrejection', (event) => {
  push(state.errors, `rejection ${describe(event.reason)}`)
})

probeFeatures()
probeStorage()
