/**
 * 在 Android WebView 里打开外部链接。
 * WebView 关闭了多窗口支持，target="_blank" 不会生效；改为同窗口导航，
 * 由 MainActivity.shouldOverrideUrlLoading 拦截后用系统浏览器打开。
 * 普通浏览器环境仍然新开标签页。
 */
export const openExternalUrl = (url: string) => {
  const bridge = (window as Window & { DeepSeekAndroid?: unknown }).DeepSeekAndroid
  if (bridge) {
    window.location.href = url
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** 是否运行在 Android 套壳里 */
export const isNativeShell = () =>
  (window as Window & { DeepSeekAndroid?: unknown }).DeepSeekAndroid !== undefined
