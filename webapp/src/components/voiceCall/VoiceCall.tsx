import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { transcribe } from '../../services/api/speech.js'
import { getDraft, setDraftText } from '../../services/chat/drafts.js'
import { sendMessage, useChatStore } from '../../services/chat/store.js'
import type { Session } from '../../services/chat/types.js'
import { canRecord, requestNativeMicrophonePermission } from '../../services/speech/micPermission.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import {
  enqueueSpeech,
  setSpeechMuted,
  stopSpeech,
  useSpeechQueue,
} from '../../services/speech/speechQueue.js'
import { useSettings } from '../../services/settings.js'
import { usePersonas } from '../../services/personas.js'
import { showToast } from '../base/toastState.js'
import { IconCloseOutline16, IconMicFill16, IconTextChatOutline18 } from '../base/icons.js'
import { closeVoiceCall, useVoiceCall } from './voiceCallState.js'
import styles from './VoiceCall.module.css'

type CallStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

/** 句子结束标点：到达这些标点就先把这一句送去合成 */
const SENTENCE_END = /[。！？!?；;\n]/

const takeSentences = (text: string, from: number): [string[], number] => {
  const sentences: string[] = []
  let start = from
  for (let index = from; index < text.length; index += 1) {
    if (SENTENCE_END.test(text[index])) {
      const sentence = text.slice(start, index + 1).trim()
      if (sentence) {
        sentences.push(sentence)
      }
      start = index + 1
    }
  }
  return [sentences, start]
}

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** 从会话里抽出双方说过的文字，按时间顺序展示 */
const cleanText = (text: string) => text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')

const collectTranscript = (session: Session | undefined) =>
  (session?.messages ?? [])
    .map((message) => {
      if (message.role === 'user') {
        return { id: message.id, role: message.role, text: cleanText(message.content.trim()) }
      }
      const text = message.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()
      return { id: message.id, role: message.role, text: cleanText(text) }
    })
    .filter((item) => item.text.length > 0)

/**
 * 语音通话：按住说话 → 转写 → 走正常发送流程（消息真实写入当前会话），
 * 回复流式到达时按句朗读；轻触中间圆形即可打断。
 */
export const VoiceCall = () => {
  const t = useTranslate()
  const open = useVoiceCall((state) => state.open)
  const speaking = useSpeechQueue((state) => state.speaking)
  const activeId = useChatStore((state) => state.activeId)
  const personas = usePersonas((state) => state.personas)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [muted, setMuted] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const recordingRef = useRef<Recording | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const spokenRef = useRef(0)
  const replyIdRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // 朗读与状态联动
  useEffect(() => {
    if (speaking && status === 'thinking') {
      setStatus('speaking')
    }
    if (!speaking && status === 'speaking') {
      setStatus('idle')
    }
  }, [speaking, status])

  // 录音计时
  useEffect(() => {
    if (status !== 'listening') {
      return
    }
    const startedAt = Date.now()
    setSeconds(0)
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [status])

  // 通话总时长
  useEffect(() => {
    if (!open) {
      return
    }
    setElapsed(0)
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [open])

  // 关闭通话时释放麦克风与朗读，并取消静音
  useEffect(() => {
    if (open) {
      return
    }
    recordingRef.current?.cancel()
    recordingRef.current = null
    stopSpeech()
    setSpeechMuted(false)
    setMuted(false)
    setShowTranscript(false)
    setStatus('idle')
    setTargetId(null)
    replyIdRef.current = null
    spokenRef.current = 0
  }, [open])

  // 监听回复流式内容，按句送去朗读
  useEffect(() => {
    if (!open) {
      return
    }
    return useChatStore.subscribe((state) => {
      const replyId = replyIdRef.current
      const sessionId = targetId ?? state.activeId
      if (!replyId || !sessionId) {
        return
      }
      const session = state.sessionCache[sessionId]
      const reply = session?.messages.find((message) => message.id === replyId)
      if (!reply || reply.role !== 'assistant') {
        return
      }
      const text = reply.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      const [sentences, next] = takeSentences(text, spokenRef.current)
      if (sentences.length > 0) {
        spokenRef.current = next
        for (const sentence of sentences) {
          enqueueSpeech(sentence)
        }
      }
      if (reply.status !== 'streaming' && reply.status !== 'pending') {
        const rest = text.slice(spokenRef.current).trim()
        spokenRef.current = text.length
        if (rest) {
          enqueueSpeech(rest)
        } else if (!text.trim()) {
          setStatus('idle')
        }
        replyIdRef.current = null
      }
    })
  }, [open, targetId])

  // 文字面板跟着最新内容滚动
  useEffect(() => {
    if (!showTranscript) {
      return
    }
    const element = transcriptRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  })

  const sendText = (text: string) => {
    const sessionId = useChatStore.getState().activeId
    const previous = getDraft(sessionId).text
    setDraftText(sessionId, text)
    if (!sendMessage(sessionId)) {
      setDraftText(sessionId, previous)
      return null
    }
    if (previous.trim()) {
      setDraftText(sessionId, previous)
    }
    const nextId = useChatStore.getState().activeId
    const session = nextId ? useChatStore.getState().sessionCache[nextId] : undefined
    const last = session?.messages.at(-1)
    replyIdRef.current = last && last.role === 'assistant' ? last.id : null
    spokenRef.current = 0
    return nextId
  }

  const startListening = async () => {
    if (busyRef.current) {
      return
    }
    if (!canRecord()) {
      showToast({ key: 'voiceInputUnavailable' })
      return
    }
    stopSpeech()
    busyRef.current = true
    try {
      if (!(await requestNativeMicrophonePermission())) {
        showToast({ key: 'voiceInputPermissionDenied' })
        return
      }
      setStatus('listening')
      const recording = await startRecording(() => {
        void finishListening()
      })
      recordingRef.current = recording
    } catch {
      setStatus('idle')
      showToast({ key: 'voiceInputFailed' })
    } finally {
      busyRef.current = false
    }
  }

  const finishListening = async () => {
    const recording = recordingRef.current
    if (!recording) {
      setStatus('idle')
      return
    }
    recordingRef.current = null
    setStatus('transcribing')
    try {
      let audio: Blob | null = null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }
      if (!audio) {
        setStatus('idle')
        showToast({ key: 'voiceInputEmpty' })
        return
      }
      const text = await transcribe(useSettings.getState().apiKey ?? '', audio)
      if (!text.trim()) {
        setStatus('idle')
        showToast({ key: 'voiceInputEmpty' })
        return
      }
      const nextId = sendText(text.trim())
      if (!nextId) {
        setStatus('idle')
        return
      }
      setTargetId(nextId)
      setStatus('thinking')
    } catch {
      setStatus('idle')
      showToast({ key: 'voiceInputFailed' })
    }
  }

  const hangUp = () => {
    stopSpeech()
    setSpeechMuted(false)
    closeVoiceCall()
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    setSpeechMuted(next)
  }

  const session = activeId ? useChatStore.getState().sessionCache[activeId] : undefined
  const personaName = session?.personaName ?? null
  const persona = personaName ? personas.find((item) => item.name === personaName) : undefined
  const displayName = personaName || session?.title || t('voiceCallDefaultTitle')
  const initial = Array.from(displayName)[0] ?? '雅'
  const transcript = useMemo(() => collectTranscript(session), [session])

  if (!open) {
    return null
  }

  const statusText =
    status === 'listening'
      ? t('voiceCallListening', { seconds })
      : status === 'transcribing'
        ? t('voiceCallTranscribing')
        : status === 'thinking'
          ? t('voiceCallThinking')
          : status === 'speaking'
            ? t('voiceCallSpeaking')
            : t('voiceCallStatusIdle')

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('voiceCallTitle')}>
      <div className={styles.glowA} aria-hidden />
      <div className={styles.glowB} aria-hidden />
      <div className={styles.topBar}>
        <div className={styles.identity}>
          <span className={styles.avatar}>
            {persona?.cover ? <img src={persona.cover} alt="" /> : initial}
          </span>
          <span className={styles.identityText}>
            <span className={styles.name}>{displayName}</span>
            <span className={styles.sub}>
              {t('voiceCallCalling')} · {formatDuration(elapsed)}
            </span>
          </span>
        </div>
        <button
          type="button"
          className={clsx(styles.transcriptBtn, showTranscript && styles.transcriptBtnActive)}
          aria-label={t('voiceCallTranscript')}
          onClick={() => setShowTranscript((value) => !value)}
        >
          <IconTextChatOutline18 />
        </button>
      </div>

      <div className={clsx(styles.stage, showTranscript && styles.stageDim)}>
        <button
          type="button"
          className={clsx(styles.orb, status === 'speaking' && styles.orbSpeaking)}
          aria-label={t('voiceCallTapToInterrupt')}
          onPointerDown={() => {
            // 朗读中或还在合成/思考时，轻触都能打断
            if (speaking || status === 'thinking') {
              stopSpeech()
            }
          }}
        >
          <span className={styles.orbInner}>
            <span className={styles.timer}>{formatDuration(elapsed)}</span>
            {status === 'speaking' ? (
              <span className={styles.orbWave} aria-hidden>
                {[0, 1, 2, 3, 4].map((index) => (
                  <span key={index} style={{ animationDelay: `${index * 0.14}s` }} />
                ))}
              </span>
            ) : null}
          </span>
        </button>
        <div className={styles.status} role="status" aria-live="polite">
          {statusText}
        </div>
        <div className={styles.hint}>{speaking ? t('voiceCallTapToInterrupt') : ''}</div>
      </div>

      <div className={styles.bottom}>
        <button
          type="button"
          className={clsx(styles.talkBtn, status === 'listening' && styles.talkBtnActive)}
          aria-label={t('holdToTalk')}
          onPointerDown={(event) => {
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            void startListening()
          }}
          onPointerUp={() => void finishListening()}
          onPointerCancel={() => void finishListening()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {status === 'listening' ? t('voiceCallRelease') : t('holdToTalk')}
        </button>
        <div className={styles.controls}>
          <button
            type="button"
            className={clsx(styles.roundBtn, muted && styles.roundBtnActive)}
            aria-label={muted ? t('voiceCallUnmute') : t('voiceCallMute')}
            onClick={toggleMute}
          >
            {muted ? <IconCloseOutline16 /> : <IconMicFill16 />}
            <span className={styles.roundLabel}>
              {muted ? t('voiceCallMuted') : t('voiceCallMute')}
            </span>
          </button>
          <button
            type="button"
            className={clsx(styles.roundBtn, styles.hangBtn)}
            aria-label={t('voiceCallHangUp')}
            onClick={hangUp}
          >
            <IconCloseOutline16 />
            <span className={styles.roundLabel}>{t('voiceCallHangUp')}</span>
          </button>
        </div>
      </div>

      {showTranscript ? (
        <div className={styles.transcript} role="region" aria-label={t('voiceCallTranscriptTitle')}>
          <div className={styles.transcriptHeader}>
            <span>{t('voiceCallTranscriptTitle')}</span>
            <button
              type="button"
              className={styles.transcriptClose}
              aria-label={t('close')}
              onClick={() => setShowTranscript(false)}
            >
              <IconCloseOutline16 />
            </button>
          </div>
          <div className={styles.transcriptBody} ref={transcriptRef}>
            {transcript.length === 0 ? (
              <p className={styles.transcriptEmpty}>{t('voiceCallEmptyTranscript')}</p>
            ) : (
              transcript.map((item) => (
                <div
                  key={item.id}
                  className={clsx(
                    styles.bubble,
                    item.role === 'user' ? styles.bubbleUser : styles.bubbleAi
                  )}
                >
                  {item.text}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
