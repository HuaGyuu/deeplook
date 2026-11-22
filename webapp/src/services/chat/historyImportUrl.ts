import { importHistory } from './backup.js'

/**
 * 从下载链接导入历史记录。
 *
 * 浏览器里直接 fetch 跨域会被 CORS 拦（DeepSeek 的链接是对象存储直链），
 * 所以在安卓壳里由原生下载到 cache，再分片以 base64 回传，拼成 Blob 走原有导入流程；
 * 导入结束后通知原生删除临时文件。普通浏览器环境退回 fetch（需要对方允许跨域）。
 */
type ImportEvent =
  | { type: 'download'; status: 'downloading' | 'done'; percent?: number; size?: number }
  | { type: 'read'; status: 'reading' | 'done'; percent?: number; chunks?: number; size?: number }
  | { type: 'error'; message?: string }

export type UrlImportProgress =
  | { phase: 'downloading'; percent: number }
  | { phase: 'reading'; percent: number }
  | { phase: 'importing'; percent: number }

type NativeBridge = {
  importHistoryFromUrl?: (url: string) => void
  cancelHistoryImport?: () => void
  deleteHistoryImport?: () => void
}

declare global {
  interface Window {
    __deeplookImportEvent?: (event: ImportEvent) => void
    __deeplookImportChunk?: (index: number, base64: string) => void
    DeepSeekAndroid?: NativeBridge
  }
}

const bridge = (): NativeBridge | undefined =>
  typeof window === 'undefined' ? undefined : window.DeepSeekAndroid

const decodeBase64 = (parts: string[], size: number): ArrayBuffer => {
  const buffer = new ArrayBuffer(size)
  const bytes = new Uint8Array(buffer)
  let offset = 0
  for (const part of parts) {
    const binary = atob(part)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[offset + index] = binary.charCodeAt(index)
    }
    offset += binary.length
  }
  return offset === size ? buffer : buffer.slice(0, offset)
}

/** 浏览器兜底：直接下载（对方未开放跨域时会失败） */
const downloadInBrowser = async (
  url: string,
  onProgress: (progress: UrlImportProgress) => void
): Promise<File> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const total = Number(response.headers.get('content-length') ?? 0)
  const reader = response.body?.getReader()
  if (!reader) {
    const blob = await response.blob()
    return new File([blob], 'deepseek_data.zip', { type: 'application/zip' })
  }
  const parts: ArrayBuffer[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    // 复制成独立的 ArrayBuffer，避免引用原 view 的偏移
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    parts.push(copy.buffer)
    received += value.length
    if (total > 0) {
      onProgress({ phase: 'downloading', percent: Math.min(100, Math.round((received / total) * 100)) })
    }
  }
  return new File(parts, 'deepseek_data.zip', { type: 'application/zip' })
}

export const validateHistoryUrl = (url: string): boolean => {
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed)
}

/** 下载 + 导入：返回导入的会话数量 */
export const importHistoryFromUrl = async (
  url: string,
  onProgress: (progress: UrlImportProgress) => void
): Promise<number> => {
  const native = bridge()
  let file: File

  if (native?.importHistoryFromUrl) {
    file = await new Promise<File>((resolve, reject) => {
      const parts: string[] = []
      let size = 0
      window.__deeplookImportChunk = (index, base64) => {
        parts[index] = base64
      }
      window.__deeplookImportEvent = (event) => {
        if (event.type === 'download') {
          if (event.status === 'downloading') {
            onProgress({ phase: 'downloading', percent: event.percent ?? 0 })
          } else if (event.status === 'done') {
            size = event.size ?? 0
            onProgress({ phase: 'reading', percent: 0 })
          }
          return
        }
        if (event.type === 'read') {
          if (event.status === 'reading') {
            onProgress({ phase: 'reading', percent: event.percent ?? 0 })
          } else if (event.status === 'done') {
            try {
              const buffer = decodeBase64(parts, size || 0)
              resolve(new File([buffer], 'deepseek_data.zip', { type: 'application/zip' }))
            } catch (error) {
              reject(error instanceof Error ? error : new Error(String(error)))
            }
          }
          return
        }
        if (event.type === 'error') {
          const message = event.message ?? 'download-failed'
          reject(new Error(message === 'cancelled' ? 'cancelled' : message))
        }
      }
      native.importHistoryFromUrl?.(url.trim())
    })
  } else {
    file = await downloadInBrowser(url, onProgress)
  }

  try {
    const count = await importHistory(file, (processed, total) => {
      const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
      onProgress({ phase: 'importing', percent })
    })
    return count
  } finally {
    // 导入完成（无论成功失败）都删掉原生下载的临时文件
    window.__deeplookImportEvent = undefined
    window.__deeplookImportChunk = undefined
    bridge()?.deleteHistoryImport?.()
  }
}
