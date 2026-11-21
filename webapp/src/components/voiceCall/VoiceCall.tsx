import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { transcribe } from '../../services/api/speech.js'
import { getDraft, setDraftText } from '../../services/chat/drafts.js'
import { sendMessage, useChatStore } from '../../services/chat/store.js'
import { canRecord, requestNativeMicrophonePermission } from '../../services/speech/micPermission.js'
import { startRecording, type Recording } from '../../services/speech/recorder.js'
import { enqueueSpeech, stopSpeech, useSpeechQueue } from '../../services/speech/speechQueue.js'
import { useSettings } from '../../services/settings.js'
import { showToast } from '../base/toastState.js'
import { IconCallOutline16, IconCloseOutline16 } from '../base/icons.js'
import { LOGO_DATA_URL } from '../../assets/logoData.js'
import { closeVoiceCall, useVoiceCall } from './voiceCallState.js'
import styles from './VoiceCall.module.css'

type CallStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

/** 句子结束标点：到达这些标点就先把这一句送去合成 */
const SENTENCE_END = /[。！？!?；;\n]/

/** 把新增长文本里已经完整的句子切出来，返回 [句子列表, 新的已读位置] */
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

/**
 * 语音通话：按住说话 → 转写 → 走正常发送流程（消息真实写入当前会话），
 * 回复流式到达时按句朗读；按住时立即停止朗读。
 */
export const VoiceCall = () => {
  const t = useTranslate()
  const open = useVoiceCall((state) => state.open)
  const speaking = useSpeechQueue((state) => state.speaking)
  const activeId = useChatStore((state) => state.activeId)
  const [status, setStatus] = useState<CallStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const recordingRef = useRef<Recording | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  /** 已朗读到的正文位置，避免同一句重复朗读 */
  const spokenRef = useRef(0)
  const replyIdRef = useRef<string | null>(null)
  const busyRef = useRef(false)

  // 朗读与状态联动：队列在播时显示「正在朗读」
  useEffect(() => {
    if (speaking && status === 'thinking') {
      setStatus('speaking')
    }
    if (!speaking && status === 'speaking') {
      setStatus('idle')
    }
  }, [speaking, status])

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

  // 关闭通话时释放麦克风与朗读
  useEffect(() => {
    if (open) {
      return
    }
    recordingRef.current?.cancel()
    recordingRef.current = null
    stopSpeech()
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
          // 没有可朗读的正文（例如请求失败），回到待说话状态
          setStatus('idle')
        }
        replyIdRef.current = null
      }
    })
  }, [open, targetId])

  /** 写入草稿并发送；发送后把用户原本输入的文字还回去 */
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
    // 按住时立刻打断正在朗读的回复
    stopSpeech()
    busyRef.current = true
    try {
      if (!(await requestNativeMicrophonePermission())) {
        showToast({ key: 'voiceInputPermissionDenied' })
        return
      }
      setStatus('listening')
      const recording = await startRecording(() => {
        // 到达单次时长上限时自动结束这一轮
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
      // 回复结束后由订阅里的朗读队列收尾，这里不主动改状态
    } catch {
      setStatus('idle')
      showToast({ key: 'voiceInputFailed' })
    }
  }

  if (!open) {
    return null
  }

  const session = activeId ? useChatStore.getState().sessionCache[activeId] : undefined
  const title = session?.title || t('voiceCallDefaultTitle')
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
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <button
          type="button"
          className={styles.hangUp}
          aria-label={t('voiceCallHangUp')}
          onClick={() => {
            stopSpeech()
            closeVoiceCall()
          }}
        >
          <IconCallOutline16 />
        </button>
      </div>
      <div className={styles.stage}>
        <div
          className={clsx(
            styles.avatar,
            (status === 'listening' || status === 'speaking') && styles.avatarActive
          )}
        >
          {status === 'speaking' ? (
            <span className={styles.wave}>
              {[0, 1, 2, 3].map((index) => (
                <span key={index} style={{ animationDelay: `${index * 0.16}s` }} />
              ))}
            </span>
          ) : null}
          <img src={LOGO_DATA_URL} alt="" aria-hidden="true" />
        </div>
        <div className={styles.status} role="status" aria-live="polite">
          {statusText}
        </div>
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={clsx(styles.talkButton, status === 'listening' && styles.talkButtonActive)}
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
        <p className={styles.hint}>{t('voiceCallHint')}</p>
      </div>
      <button
        type="button"
        className={styles.closeIcon}
        aria-label={t('close')}
        onClick={() => {
          stopSpeech()
          closeVoiceCall()
        }}
      >
        <IconCloseOutline16 />
      </button>
    </div>
  )
}
