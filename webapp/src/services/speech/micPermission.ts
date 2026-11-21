type AndroidMicBridge = { requestMicrophone?: (requestId: string) => void }

/**
 * 安卓 WebView 里先向原生申请 RECORD_AUDIO，拿到授权后再 getUserMedia。
 * 这样不会因为系统权限弹窗打断 WebView 的 PermissionRequest 而直接录音失败。
 * 普通浏览器返回 true，由 getUserMedia 自己弹权限。
 */
export const requestNativeMicrophonePermission = (): Promise<boolean> => {
  if (typeof window === 'undefined') {
    return Promise.resolve(false)
  }
  const bridge = (window as Window & { DeepSeekAndroid?: AndroidMicBridge }).DeepSeekAndroid
  if (!bridge?.requestMicrophone) {
    return Promise.resolve(true)
  }
  return new Promise<boolean>((resolve) => {
    const requestId = `mic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const target = window as Window & {
      __deeplookMicPermission?: (id: string, granted: boolean) => void
    }
    const timer = window.setTimeout(() => {
      cleanup()
      resolve(false)
    }, 20000)
    const cleanup = () => {
      window.clearTimeout(timer)
      delete target.__deeplookMicPermission
    }
    target.__deeplookMicPermission = (id, granted) => {
      if (id !== requestId) {
        return
      }
      cleanup()
      resolve(granted)
    }
    bridge.requestMicrophone?.(requestId)
  })
}

/** 录音依赖 getUserMedia，只在安全上下文可用（HTTPS、localhost、file://） */
export const canRecord = () =>
  typeof window === 'undefined' || window.isSecureContext
