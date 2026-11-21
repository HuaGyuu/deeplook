import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconCameraOutline20,
  IconCloseOutline16,
  IconGlobeLanguageOutline14,
  IconImageOutline16,
  IconKeyboardOutline16,
  IconMicOutline16,
  IconPaperclipOutline16,
  IconPlusOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

/** 上滑超过该距离（px）就取消本次语音发送 */
const CANCEL_DISTANCE = 60

/**
 * 输入框：自适应文本 + 深度思考 / 智能搜索开关 + 加号（拍照 / 相册 / 文件）+ 右侧语音 / 发送切换。
 * 语音按钮进入「按住说话」模式：按住录音、上滑取消、松开发送。
 */
export const ChatInput = memo(function ChatInput({ sessionId }: { sessionId: string | null }) {
  // 切换目标时释放录音、转写和 DOM 状态；文字与附件由草稿服务保留。
  return <Input key={sessionId === null ? 'new' : `session:${sessionId}`} sessionId={sessionId} />
})

const Input = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const { text, attachments } = draft
  const setText = (value: string) => setDraftText(sessionId, value)
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  /** 按住说话模式：文本框换成大号按住说话区域 */
  const [voiceMode, setVoiceMode] = useState(false)
  /** 加号展开的附件面板 */
  const [panelOpen, setPanelOpen] = useState(false)
  /** 按住说话浮层：显示松开发送 / 上滑取消 */
  const [holding, setHolding] = useState(false)
  const [cancelHolding, setCancelHolding] = useState(false)
  const holdStartYRef = useRef(0)
  /** 这次按住的结果要直接发送，而不是把文字填进输入框 */
  const holdSendRef = useRef(false)

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (files.length === 0 || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 按住说话的结果：直接发送，不再写进输入框 */
  const sendSpokenText = (spoken: string) => {
    if (useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const previous = getDraft(sessionId).text
    setDraftText(sessionId, spoken)
    if (!sendMessage(sessionId)) {
      setDraftText(sessionId, previous)
      return
    }
    // 用户原本输入了一半的文字还回去
    if (previous.trim()) {
      setDraftText(sessionId, previous)
    }
    stopReadAloud()
  }

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    if (holdSendRef.current) {
      holdSendRef.current = false
      sendSpokenText(transcript)
      return
    }
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  })

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  const transcribing = voice.status === 'transcribing'
  /** 有文字或附件时右侧按钮变成发送 */
  const hasContent = text.trim() !== '' || attachments.length > 0
  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const canSend = !importingHistory && !streaming && voice.status === 'idle' && draftReady

  const send = () => {
    if (
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const holdStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (importingHistory || streaming || !ensureApiKey()) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    holdStartYRef.current = event.clientY
    holdSendRef.current = true
    setCancelHolding(false)
    setHolding(true)
    stopReadAloud()
    void voice.start()
  }
  const holdMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!holding) {
      return
    }
    const dy = event.clientY - holdStartYRef.current
    setCancelHolding(dy < -CANCEL_DISTANCE)
  }
  const holdEnd = () => {
    if (!holding) {
      return
    }
    setHolding(false)
    if (cancelHolding) {
      holdSendRef.current = false
      setCancelHolding(false)
      voice.cancel()
      return
    }
    if (voice.status === 'recording') {
      void voice.stop()
    } else {
      holdSendRef.current = false
    }
  }

  return (
    <div className={styles.root}>
      <div
        className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            textareaRef.current?.focus({ preventScroll: true })
          }
        }}
      >
        <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />
        {voiceMode ? (
          <>
            <button
              type="button"
              className={clsx(styles.holdToTalk, holding && styles.holdToTalkActive)}
              aria-label={t('holdToTalk')}
              disabled={importingHistory || streaming}
              onPointerDown={holdStart}
              onPointerMove={holdMove}
              onPointerUp={holdEnd}
              onPointerCancel={holdEnd}
              onContextMenu={(event) => event.preventDefault()}
            >
              {transcribing ? t('voiceInputTranscribing') : t('holdToTalk')}
            </button>
            <div className={styles.holdDivider} />
          </>
        ) : (
          <div className={styles.textareaWrapper}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder={t('chatInputPlaceholderVoice')}
              rows={2}
              // 移动端不自动聚焦，避免一打开就弹出键盘
              autoFocus={!isMobile}
              disabled={importingHistory}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onFocus={() => setPanelOpen(false)}
              onMouseDown={(event) => {
                // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
                if (
                  isMobile &&
                  event.button === 0 &&
                  document.activeElement !== event.currentTarget
                ) {
                  event.preventDefault()
                  event.currentTarget.focus({ preventScroll: true })
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send()
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files)
                if (files.length > 0) {
                  event.preventDefault()
                  acceptFiles(files)
                }
              }}
            />
            <div className={styles.mirror} aria-hidden>
              {`${text}\n`}
            </div>
          </div>
        )}
        <div className={styles.functionRow}>
          {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
          <div ref={togglesRef} className={styles.toggles}>
            <Tooltip content={t('deactivatedThinkTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, thinking && styles.selected)}
                aria-label={t('thinkingSwitch')}
                aria-pressed={thinking}
                onClick={() => setThinking(!thinking)}
              >
                <IconThinkOutline14 />
                <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
              </button>
            </Tooltip>
            <Tooltip content={t('deactivatedSearchTooltip')}>
              <button
                type="button"
                className={clsx(styles.toggle, search && styles.selected)}
                aria-label={t('search')}
                aria-pressed={search}
                onClick={() => setSearch(!search)}
              >
                <IconGlobeLanguageOutline14 />
                <span className={styles.toggleLabel}>{t('search')}</span>
              </button>
            </Tooltip>
          </div>
          <div className={styles.right}>
            <button
              type="button"
              className={clsx(styles.roundButton, panelOpen && styles.roundButtonActive)}
              aria-label={panelOpen ? t('close') : t('moreActions')}
              aria-expanded={panelOpen}
              disabled={importingHistory}
              onClick={() => {
                if (ensureApiKey()) {
                  setPanelOpen((open) => !open)
                }
              }}
            >
              {panelOpen ? <IconCloseOutline16 /> : <IconPlusOutline16 />}
            </button>
            {streaming && sessionId ? (
              <button
                type="button"
                className={styles.sendButton}
                aria-label={t('chatInputStopButtonTooltip')}
                onClick={() => {
                  stopReadAloud()
                  stopReply(sessionId)
                }}
              >
                <IconStopFill16 />
              </button>
            ) : voiceMode ? (
              <button
                type="button"
                className={styles.roundButton}
                aria-label={t('switchToKeyboard')}
                onClick={() => setVoiceMode(false)}
              >
                <IconKeyboardOutline16 />
              </button>
            ) : hasContent ? (
              <button
                type="button"
                className={clsx(styles.sendButton, !canSend && styles.disabled)}
                aria-label={t('send')}
                aria-disabled={!canSend}
                onClick={send}
              >
                <IconSendOutline16 />
              </button>
            ) : (
              <button
                type="button"
                className={styles.roundButton}
                aria-label={t('switchToVoiceMode')}
                onClick={() => {
                  setPanelOpen(false)
                  setVoiceMode(true)
                  textareaRef.current?.blur()
                }}
              >
                <IconMicOutline16 />
              </button>
            )}
          </div>
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            acceptFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            acceptFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          onChange={(event) => {
            acceptFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        {dragging ? <DragMask /> : null}
      </div>
      <div className={clsx(styles.attachPanel, panelOpen && styles.attachPanelOpen)}>
        <button
          type="button"
          className={styles.attachAction}
          onClick={() => {
            setPanelOpen(false)
            if (ensureApiKey()) {
              cameraInputRef.current?.click()
            }
          }}
        >
          <IconCameraOutline20 />
          <span>{t('attachCamera')}</span>
        </button>
        <button
          type="button"
          className={styles.attachAction}
          onClick={() => {
            setPanelOpen(false)
            if (ensureApiKey()) {
              imageInputRef.current?.click()
            }
          }}
        >
          <IconImageOutline16 />
          <span>{t('attachGallery')}</span>
        </button>
        <button
          type="button"
          className={styles.attachAction}
          onClick={() => {
            setPanelOpen(false)
            if (ensureApiKey()) {
              fileInputRef.current?.click()
            }
          }}
        >
          <IconPaperclipOutline16 />
          <span>{t('attachFile')}</span>
        </button>
      </div>
      {holding
        ? createPortal(
            <div
              className={clsx(styles.holdOverlay, cancelHolding && styles.holdOverlayCancel)}
              role="status"
              aria-live="polite"
            >
              <div className={styles.holdOverlayText}>
                {cancelHolding ? t('holdToTalkCancel') : t('holdToTalkSendHint')}
              </div>
              <Spectrum getAnalyser={voice.getAnalyser} className={styles.holdOverlayWave} />
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

