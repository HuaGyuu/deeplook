import { create } from 'zustand'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { useSettings } from '../settings.js'
import { createPcmPlayer } from './pcmPlayer.js'

/**
 * 语音通话用的朗读队列：把回复按句推入，按顺序合成并播放。
 * 与「朗读回复」按钮不同，这里支持边接收边排队，且可以被按住说话打断。
 */
type SpeechState = { speaking: boolean }

export const useSpeechQueue = create<SpeechState>(() => ({ speaking: false }))

/** 静音：只关掉朗读，文字照常显示 */
let speechMuted = false

export const setSpeechMuted = (value: boolean) => {
  speechMuted = value
  if (value) {
    stopSpeech()
  }
}

export const isSpeechMuted = () => speechMuted

type Session = {
  controller: AbortController
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
    queue: [],
    running: false,
  }
  return session
}

/** 播放一段文字，返回播放结束的 Promise；被中断时提前结束 */
const speakSegment = async (state: Session, text: string): Promise<void> => {
  const { apiKey, ttsVoice } = useSettings.getState()
  const stream = await synthesize(apiKey ?? '', text, ttsVoice, state.controller.signal)
  const reader = stream.getReader()
  const player = createPcmPlayer(TTS_SAMPLE_RATE)
  const onAbort = () => {
    player.cancel()
    void reader.cancel().catch(() => {})
  }
  state.controller.signal.addEventListener('abort', onAbort)
  useSpeechQueue.setState({ speaking: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (state.controller.signal.aborted) {
        break
      }
      player.push(value)
    }
    if (!state.controller.signal.aborted) {
      await player.finish()
    }
  } finally {
    state.controller.signal.removeEventListener('abort', onAbort)
    player.cancel()
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
  if (!trimmed || speechMuted) {
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
  session = null
}
