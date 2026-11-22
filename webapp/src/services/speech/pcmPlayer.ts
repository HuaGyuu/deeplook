/**
 * PCM 播放：优先走原生 AudioTrack（媒体音量、USAGE_MEDIA），
 * 浏览器环境退回 WebAudio。两条路径暴露同一套 push / finish / cancel。
 */
type NativeTtsBridge = {
  ttsStart?: (sampleRate: number) => void
  ttsWrite?: (base64: string) => void
  ttsEnd?: () => void
  ttsCancel?: () => void
}

declare global {
  interface Window {
    __deeplookTtsEnded?: () => void
  }
}

const bridge = (): NativeTtsBridge | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as Window & { DeepSeekAndroid?: NativeTtsBridge }).DeepSeekAndroid

/** 原生播放结束回调：由 AudioTrack 播完缓冲后调用 */
if (typeof window !== 'undefined' && !window.__deeplookTtsEnded) {
  window.__deeplookTtsEnded = () => {
    endedResolver?.()
    endedResolver = null
  }
}

let endedResolver: (() => void) | null = null

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

export type PcmPlayer = {
  /** 追加一段 16-bit 小端单声道 PCM */
  push: (bytes: Uint8Array) => void
  /** 全部推完后调用：等待播放真正结束 */
  finish: () => Promise<void>
  /** 立即停止并释放 */
  cancel: () => void
  /** 首次出声时回调，用于把状态从 loading 切到 playing */
  onStart?: () => void
}

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

export const createPcmPlayer = (sampleRate: number): PcmPlayer => {
  const native = bridge()

  // ---- 原生 AudioTrack：音频走媒体的音量 ----
  if (native?.ttsStart) {
    native.ttsStart(sampleRate)
    let started = false
    const player: PcmPlayer = {
      push: (bytes) => {
        if (bytes.length === 0) {
          return
        }
        if (!started) {
          started = true
          player.onStart?.()
        }
        native.ttsWrite?.(bytesToBase64(bytes))
      },
      finish: () =>
        new Promise<void>((resolve) => {
          if (!started) {
            native.ttsCancel?.()
            resolve()
            return
          }
          endedResolver = resolve
          native.ttsEnd?.()
        }),
      cancel: () => {
        endedResolver = null
        native.ttsCancel?.()
      },
    }
    return player
  }

  // ---- 浏览器回退：WebAudio 排程 ----
  const context = new AudioContext({ sampleRate })
  let nextTime = 0
  let lastSource: AudioBufferSourceNode | null = null
  let rest = new Uint8Array(0)
  let closed = false

  const player: PcmPlayer = {
    push: (bytes) => {
      if (closed) {
        return
      }
      const merged = new Uint8Array(rest.length + bytes.length)
      merged.set(rest)
      merged.set(bytes, rest.length)
      const samples = toFloat32(merged)
      rest = merged.slice(samples.length * 2)
      if (samples.length === 0) {
        return
      }
      const buffer = context.createBuffer(1, samples.length, sampleRate)
      buffer.copyToChannel(samples, 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
      source.start(nextTime)
      nextTime += buffer.duration
      lastSource = source
      player.onStart?.()
    },
    finish: () => {
      if (closed) {
        return Promise.resolve()
      }
      if (!lastSource) {
        closed = true
        void context.close().catch(() => {})
        return Promise.resolve()
      }
      const last = lastSource
      return new Promise<void>((resolve) => {
        last.onended = () => {
          closed = true
          void context.close().catch(() => {})
          resolve()
        }
      })
    },
    cancel: () => {
      if (closed) {
        return
      }
      closed = true
      try {
        lastSource?.stop()
      } catch {
        // 停止已结束的节点会抛错，忽略
      }
      void context.close().catch(() => {})
    },
  }
  return player
}
