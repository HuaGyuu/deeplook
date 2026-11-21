import { create } from 'zustand'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { useSettings } from '../settings.js'

/**
 * 语音通话用的朗读队列：把回复按句推入，按顺序合成并播放。
 * 与「朗读回复」按钮不同，这里支持边接收边排队，且可以被按住说话打断。
 */
type SpeechState = { speaking: boolean }

export const useSpeechQueue = create<SpeechState>(() => ({ speaking: false }))

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

type Session = {
  controller: AbortController
  context: AudioContext | null
  queue: string[]
  running: boolean
}

let session: Session | null = null

const ensureSession = (): Session => {
  if (session) {
    return session
  }
  session = {
    controller: new AbortController(),
    context: null,
    queue: [],
    running: false,
  }
  return session
}

const contextOf = (state: Session): AudioContext => {
  if (!state.context) {
    state.context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  }
  if (state.context.state === 'suspended') {
    void state.context.resume().catch(() => {})
  }
  return state.context
}

/** 播放一段文字，返回播放结束的 Promise；被中断时提前结束 */
const speakSegment = async (state: Session, text: string): Promise<void> => {
  const { apiKey, ttsVoice } = useSettings.getState()
  const context = contextOf(state)
  const stream = await synthesize(apiKey ?? '', text, ttsVoice, state.controller.signal)
  const reader = stream.getReader()
  const onAbort = () => void reader.cancel().catch(() => {})
  state.controller.signal.addEventListener('abort', onAbort)
  let nextTime = 0
  let lastSource: AudioBufferSourceNode | null = null
  let rest = new Uint8Array(0)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const bytes = new Uint8Array(rest.length + value.length)
      bytes.set(rest)
      bytes.set(value, rest.length)
      const samples = toFloat32(bytes)
      rest = bytes.slice(samples.length * 2)
      if (samples.length === 0) {
        continue
      }
      const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
      buffer.copyToChannel(samples, 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
      source.start(nextTime)
      nextTime += buffer.duration
      lastSource = source
    }
    if (!lastSource) {
      return
    }
    const last = lastSource
    await new Promise<void>((resolve) => {
      last.onended = () => resolve()
      // 中断后 onended 可能不触发，兜底按时长结束
      const wait = Math.max(0, nextTime - context.currentTime) * 1000 + 200
      window.setTimeout(resolve, wait)
    })
  } finally {
    state.controller.signal.removeEventListener('abort', onAbort)
  }
}

const pump = async (state: Session) => {
  if (state.running) {
    return
  }
  state.running = true
  useSpeechQueue.setState({ speaking: true })
  try {
    while (state.queue.length > 0 && !state.controller.signal.aborted) {
      const text = state.queue.shift()
      if (!text) {
        continue
      }
      await speakSegment(state, text)
    }
  } catch {
    // 合成或播放失败时停止本轮朗读，不阻塞后续输入
  } finally {
    state.running = false
    if (session === state) {
      useSpeechQueue.setState({ speaking: state.queue.length > 0 })
    }
  }
}

/** 推入一句待朗读的文字（标点交给 TTS 过滤） */
export const enqueueSpeech = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) {
    return
  }
  const state = ensureSession()
  state.queue.push(trimmed)
  void pump(state)
}

/** 立即停止朗读并清空队列（按住说话、挂断时调用） */
export const stopSpeech = () => {
  if (!session) {
    return
  }
  session.controller.abort()
  session.queue = []
  session.running = false
  useSpeechQueue.setState({ speaking: false })
  const context = session.context
  session = null
  if (context) {
    void context.close().catch(() => {})
  }
}
