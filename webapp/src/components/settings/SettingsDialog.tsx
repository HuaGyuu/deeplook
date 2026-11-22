import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconGlobeLanguageOutline14,
  IconInfoOutline16,
  IconLightOutline16,
  IconLocationOutline16,
  IconPaletteOutline16,
  IconPersonOutline16,
  IconPlayMediaOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { APP_VERSION } from '../../services/appVersion.js'
import { UpdateChecker } from './UpdateChecker.js'
import { LOGO_DATA_URL } from '../../assets/logoData.js'
import { WECHAT_QR_DATA_URL } from '../../assets/wechatQrData.js'
import { openExternalUrl } from '../../services/externalLink.js'
import { useChatStore } from '../../services/chat/store.js'
import { importHistoryFromUrl, validateHistoryUrl } from '../../services/chat/historyImportUrl.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setAiPersona,
  setChatBackground,
  setChatBackgroundAdjust,
  setLocale,
  setLocation,
  setThemePreference,
  setTtsVoice,
  setUserPersona,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, registerSettingsBackHandler, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/** 设置页的二级页面 */
type SettingsPage =
  | 'root'
  | 'persona'
  | 'personalization'
  | 'appearance'
  | 'language'
  | 'voice'
  | 'location'
  | 'data'
  | 'about'

const pageTitles: Record<Exclude<SettingsPage, 'root'>, TranslationKey> = {
  persona: 'personaSettings',
  personalization: 'personalization',
  appearance: 'appearance',
  language: 'language',
  voice: 'settingsTtsVoice',
  location: 'settingsLocation',
  data: 'dataManagement',
  about: 'aboutApp',
}

/** 设置入口：不再使用弹窗，打开后是全屏设置页（桌面端为居中面板），内部二级菜单导航。 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsPageView /> : null
}

const SettingsPageView = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const initial: SettingsSection = useSettingsDialog.getState().section
  const [page, setPage] = useState<SettingsPage>(initial === 'data' ? 'data' : 'root')
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || historyDelete.busy) {
        return
      }
      if (page === 'root') {
        closeSettings()
      } else {
        setPage('root')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page, historyDelete.busy])

  // 系统返回键：二级页面先回到设置首页，由原生 __deeplookBack 调用
  useEffect(
    () =>
      registerSettingsBackHandler(() => {
        if (page === 'root') {
          return false
        }
        setPage('root')
        return true
      }),
    [page]
  )

  const title = page === 'root' ? t('settings') : t(pageTitles[page])
  return (
    <div className={styles.page} role="dialog" aria-modal="true" aria-label={t('settings')}>
      <div className={styles.pageHeader}>
        <button
          type="button"
          className={styles.backButton}
          aria-label={page === 'root' ? t('close') : t('back')}
          onClick={() => (page === 'root' ? closeSettings() : setPage('root'))}
        >
          <IconChevronRightOutline14 />
        </button>
        <div className={styles.pageTitle}>{title}</div>
        <span className={styles.headerSpacer} />
      </div>
      <div className={styles.pageBody}>
        {page === 'root' ? <SettingsRoot onNavigate={setPage} /> : null}
        {page === 'persona' ? <PersonaSettings /> : null}
        {page === 'personalization' ? <PersonalizationSettings /> : null}
        {page === 'appearance' ? <ThemeSetting /> : null}
        {page === 'language' ? <LocaleSetting /> : null}
        {page === 'voice' ? <TtsVoiceSetting /> : null}
        {page === 'location' ? <LocationSetting /> : null}
        {page === 'about' ? <AboutApp /> : null}
        {page === 'data' ? (
          <>
            <ApiKeyField editor={apiKeyEditor} />
            <ImportHistory historyImport={historyImport} disabled={historyBusy} />
            <ImportHistoryUrl disabled={historyBusy} />
            <ExportHistory disabled={historyBusy} />
            <SettingCell
              label={t('deleteAllSessions')}
              status={null}
              action={
                <Button
                  variant="dangerOutlined"
                  size="m"
                  className={styles.cellButton}
                  disabled={historyBusy}
                  onClick={historyDelete.open}
                >
                  {t('delete')}
                </Button>
              }
            />
            {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
          </>
        ) : null}
      </div>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </div>
  )
}

/** 设置首页：分组列表，点每一项进入二级页面（类似 iOS 设置） */
const SettingsRoot = ({ onNavigate }: { onNavigate: (page: SettingsPage) => void }) => {
  const t = useTranslate()
  const settings = useSettings()
  const themeLabel =
    settings.themePreference === 'light'
      ? t('themeLight')
      : settings.themePreference === 'dark'
        ? t('themeDark')
        : t('themeSystem')
  const localeLabel = settings.locale === 'zh-CN' ? t('settingsLocaleZhCN') : t('settingsLocaleEnUS')
  const voiceLabel =
    settings.ttsVoice === 'tide' ? t('settingsTtsVoiceTide') : t('settingsTtsVoiceStella')
  const locationLabel = settings.location
    ? settings.location.region === 'CN' && settings.location.province
      ? (provinces.find((item) => item.code === settings.location?.province)?.name ??
        t('valueSet'))
      : getRegionName(settings.location.region, settings.locale)
    : t('valueNotSet')

  const groups: {
    title: string
    rows: { page: SettingsPage; icon: ReactNode; label: string; value?: string }[]
  }[] = [
    {
      title: t('settingsGroupAccount'),
      rows: [
        {
          page: 'data',
          icon: <IconDataOutline16 />,
          label: t('dataManagement'),
          value: settings.apiKey ? t('apiKeyStatusSet') : t('apiKeyStatusUnset'),
        },
      ],
    },
    {
      title: t('settingsGroupApp'),
      rows: [
        {
          page: 'persona',
          icon: <IconPersonOutline16 />,
          label: t('personaSettings'),
          value: settings.userPersona || settings.aiPersona ? t('valueSet') : '',
        },
        {
          page: 'personalization',
          icon: <IconPaletteOutline16 />,
          label: t('personalization'),
          value: settings.chatBackground ? t('valueSet') : '',
        },
        {
          page: 'appearance',
          icon: <IconLightOutline16 />,
          label: t('appearance'),
          value: themeLabel,
        },
        {
          page: 'language',
          icon: <IconGlobeLanguageOutline14 />,
          label: t('language'),
          value: localeLabel,
        },
        {
          page: 'location',
          icon: <IconLocationOutline16 />,
          label: t('settingsLocation'),
          value: locationLabel,
        },
      ],
    },
    {
      title: t('settingsGroupVoice'),
      rows: [
        {
          page: 'voice',
          icon: <IconPlayMediaOutline16 />,
          label: t('settingsTtsVoice'),
          value: voiceLabel,
        },
      ],
    },
    {
      title: t('settingsGroupAbout'),
      rows: [
        { page: 'about', icon: <IconInfoOutline16 />, label: t('aboutApp'), value: APP_VERSION },
      ],
    },
  ]

  return (
    <div className={styles.rootMenu}>
      {groups.map((group) => (
        <div key={group.title} className={styles.group}>
          <div className={styles.groupTitle}>{group.title}</div>
          <div className={styles.groupCard}>
            {group.rows.map((row) => (
              <button
                key={row.page}
                type="button"
                className={styles.menuRow}
                onClick={() => onNavigate(row.page)}
              >
                <span className={styles.menuIcon}>{row.icon}</span>
                <span className={styles.menuLabel}>{row.label}</span>
                {row.value ? <span className={styles.menuValue}>{row.value}</span> : null}
                <span className={styles.menuChevron}>
                  <IconChevronRightOutline14 />
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 人设设置：AI 人设 + 用户人设，改完立即保存，每次请求注入系统提示 */
const PersonaSettings = () => {
  const t = useTranslate()
  const userPersona = useSettings((state) => state.userPersona)
  const aiPersona = useSettings((state) => state.aiPersona)
  const [saved, setSaved] = useState(false)
  return (
    <div className={styles.subpage}>
      <p className={styles.subpageHint}>{t('personaHint')}</p>
      <label className={styles.fieldBlock}>
        <span className={styles.fieldLabel}>{t('personaAiLabel')}</span>
        <textarea
          className={styles.textarea}
          rows={5}
          value={aiPersona}
          placeholder={t('personaAiPlaceholder')}
          onChange={(event) => {
            setAiPersona(event.target.value)
            setSaved(false)
          }}
        />
      </label>
      <label className={styles.fieldBlock}>
        <span className={styles.fieldLabel}>{t('personaUserLabel')}</span>
        <textarea
          className={styles.textarea}
          rows={5}
          value={userPersona}
          placeholder={t('personaUserPlaceholder')}
          onChange={(event) => {
            setUserPersona(event.target.value)
            setSaved(false)
          }}
        />
      </label>
      <div className={styles.subpageActions}>
        <span className={styles.saveHint}>{saved ? t('saved') : ''}</span>
        <Button variant="primary" size="m" onClick={() => setSaved(true)}>
          {t('save')}
        </Button>
      </div>
    </div>
  )
}

/** 把选中的图片压到合适尺寸再存 localStorage，避免超出配额 */
const compressImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const maxSide = 1600
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('canvas unavailable')
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('image load failed'))
    }
    image.src = objectUrl
  })

/** 个性化：聊天背景图 */
/** 手机屏幕形状的比例，用于裁剪框与预览；移动端直接跟随 WebView 视口，保证和真实背景一致 */
const phoneAspect = () => {
  if (typeof window === 'undefined') {
    return '9 / 19.5'
  }
  const ratio = window.innerWidth / window.innerHeight
  return ratio > 0.75 ? '9 / 19.5' : `${window.innerWidth} / ${window.innerHeight}`
}

/** 把背景层按“移动/缩放”的变换套用，预览和聊天页共用同一套参数 */
const backgroundTransform = (scale: number, offsetX: number, offsetY: number) =>
  `translate(${offsetX}%, ${offsetY}%) scale(${scale / 100})`

const PersonalizationSettings = () => {
  const t = useTranslate()
  const chatBackground = useSettings((state) => state.chatBackground)
  const scrim = useSettings((state) => state.chatBackgroundScrim)
  const scale = useSettings((state) => state.chatBackgroundScale)
  const offsetX = useSettings((state) => state.chatBackgroundOffsetX)
  const offsetY = useSettings((state) => state.chatBackgroundOffsetY)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  // 选图后先进入裁剪界面，确认后才真正应用
  const [cropSource, setCropSource] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file) {
      return
    }
    setBusy(true)
    try {
      const dataUrl = await compressImage(file)
      setCropSource(dataUrl)
    } catch {
      showToast({ key: 'chatBackgroundFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    setChatBackground('')
    setChatBackgroundAdjust({ scrim: 72, scale: 100, offsetX: 0, offsetY: 0 })
  }

  if (cropSource) {
    return (
      <BackgroundCrop
        image={cropSource}
        initialScale={chatBackground ? scale : 100}
        initialOffsetX={chatBackground ? offsetX : 0}
        initialOffsetY={chatBackground ? offsetY : 0}
        onCancel={() => setCropSource(null)}
        onConfirm={(value) => {
          if (!setChatBackground(value.dataUrl)) {
            showToast({ key: 'chatBackgroundTooLarge', type: 'error' })
            return
          }
          setChatBackgroundAdjust({ scale: 100, offsetX: 0, offsetY: 0 })
          setCropSource(null)
        }}
      />
    )
  }

  return (
    <div className={styles.subpage}>
      <p className={styles.subpageHint}>{t('chatBackgroundHint')}</p>
      <div className={styles.phonePreviewWrap}>
        <div className={styles.phonePreview} style={{ aspectRatio: phoneAspect() }}>
          {chatBackground ? (
            <>
              <div
                className={styles.phonePreviewImage}
                style={{
                  backgroundImage: `url("${chatBackground}")`,
                  transform: backgroundTransform(scale, offsetX, offsetY),
                }}
              />
              <div
                className={styles.phonePreviewScrim}
                style={{ background: `rgba(var(--chat-bg-scrim-rgb), ${scrim / 100})` }}
              />
            </>
          ) : (
            <span>{t('chatBackgroundDefault')}</span>
          )}
        </div>
      </div>
      {chatBackground ? (
        <>
          <p className={styles.subpageHint}>{t('chatBackgroundAdjustHint')}</p>
          <RangeSlider
            label={t('bgScrimLabel')}
            value={scrim}
            min={0}
            max={100}
            onChange={(value) => setChatBackgroundAdjust({ scrim: value })}
          />
        </>
      ) : null}
      <div className={styles.subpageActions}>
        <Button
          variant="outlined"
          size="m"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {t('chatBackgroundPick')}
        </Button>
        {chatBackground ? (
          <Button
            variant="outlined"
            size="m"
            disabled={busy}
            onClick={() => setCropSource(chatBackground)}
          >
            {t('chatBackgroundAdjust')}
          </Button>
        ) : null}
        {chatBackground ? (
          <Button variant="outlined" size="m" disabled={busy} onClick={reset}>
            {t('chatBackgroundClear')}
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void pick(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

/**
 * 背景裁剪界面：完整图片显示在取景框后面，框外压暗、框内即最终背景。
 * 单指拖动调整位置，双指缩放；确认时把框内区域画到 canvas，确保实际背景与预览一致。
 */
const BackgroundCrop = ({
  image,
  initialScale,
  initialOffsetX,
  initialOffsetY,
  onCancel,
  onConfirm,
}: {
  image: string
  initialScale: number
  initialOffsetX: number
  initialOffsetY: number
  onCancel: () => void
  onConfirm: (value: { dataUrl: string }) => void
}) => {
  const t = useTranslate()
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const [imageRatio, setImageRatio] = useState(1)
  const [layout, setLayout] = useState({ width: 0, height: 0 })
  const [scale, setScale] = useState(Math.max(1, initialScale / 100))
  const [offset, setOffset] = useState({ x: initialOffsetX, y: initialOffsetY })
  const scaleRef = useRef(scale)
  const offsetRef = useRef(offset)
  scaleRef.current = scale
  offsetRef.current = offset

  // 读取图片宽高比，图片以 contain 方式完整显示
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setImageRatio(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = image
  }, [image])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const update = () => setLayout({ width: stage.clientWidth, height: stage.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // 图片按 contain 的基准尺寸铺在舞台上，再叠加 translate/scale
  const baseWidth = layout.width ? Math.min(layout.width, layout.height * imageRatio) : 0
  const baseHeight = baseWidth && imageRatio ? baseWidth / imageRatio : 0
  const baseLeft = (layout.width - baseWidth) / 2
  const baseTop = (layout.height - baseHeight) / 2

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }
    const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    let pan: { x: number; y: number; startX: number; startY: number } | null = null
    let pinch: { distance: number; scale: number } | null = null

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0]
        pan = {
          x: offsetRef.current.x,
          y: offsetRef.current.y,
          startX: touch.clientX,
          startY: touch.clientY,
        }
        pinch = null
      } else if (event.touches.length === 2) {
        pinch = {
          distance: distance(event.touches[0], event.touches[1]),
          scale: scaleRef.current,
        }
        pan = null
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2 && pinch) {
        event.preventDefault()
        setScale(Math.min(6, Math.max(0.3, (pinch.scale * distance(event.touches[0], event.touches[1])) / pinch.distance)))
      } else if (event.touches.length === 1 && pan) {
        event.preventDefault()
        const touch = event.touches[0]
        setOffset({ x: pan.x + touch.clientX - pan.startX, y: pan.y + touch.clientY - pan.startY })
      }
    }

    const onTouchEnd = () => {
      pan = null
      pinch = null
    }

    stage.addEventListener('touchstart', onTouchStart, { passive: true })
    stage.addEventListener('touchmove', onTouchMove, { passive: false })
    stage.addEventListener('touchend', onTouchEnd)
    stage.addEventListener('touchcancel', onTouchEnd)
    return () => {
      stage.removeEventListener('touchstart', onTouchStart)
      stage.removeEventListener('touchmove', onTouchMove)
      stage.removeEventListener('touchend', onTouchEnd)
      stage.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  const cropToDataUrl = () => {
    const img = imageRef.current
    const guide = guideRef.current
    if (!img || !guide || !img.naturalWidth || !img.naturalHeight) {
      return null
    }
    const imageRect = img.getBoundingClientRect()
    const guideRect = guide.getBoundingClientRect()
    if (!imageRect.width || !imageRect.height) {
      return null
    }
    const sx = ((guideRect.left - imageRect.left) / imageRect.width) * img.naturalWidth
    const sy = ((guideRect.top - imageRect.top) / imageRect.height) * img.naturalHeight
    const sw = (guideRect.width / imageRect.width) * img.naturalWidth
    const sh = (guideRect.height / imageRect.height) * img.naturalHeight
    const left = Math.max(0, sx)
    const top = Math.max(0, sy)
    const right = Math.min(img.naturalWidth, sx + sw)
    const bottom = Math.min(img.naturalHeight, sy + sh)
    if (right <= left || bottom <= top) {
      return null
    }
    const outputWidth = 900
    const outputHeight = Math.round((outputWidth * guideRect.height) / guideRect.width)
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (!context) {
      return null
    }
    context.fillStyle = '#000'
    context.fillRect(0, 0, outputWidth, outputHeight)
    const dx = ((left - sx) / sw) * outputWidth
    const dy = ((top - sy) / sh) * outputHeight
    const dw = ((right - left) / sw) * outputWidth
    const dh = ((bottom - top) / sh) * outputHeight
    context.drawImage(img, left, top, right - left, bottom - top, dx, dy, dw, dh)
    return canvas.toDataURL('image/jpeg', 0.9)
  }

  return (
    <div className={styles.cropScreen}>
      <p className={styles.subpageHint}>{t('chatBackgroundCropHint')}</p>
      <div ref={stageRef} className={styles.cropStage}>
        <img
          ref={imageRef}
          className={styles.cropSource}
          src={image}
          alt=""
          draggable={false}
          style={{
            left: baseLeft,
            top: baseTop,
            width: baseWidth,
            height: baseHeight,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
        />
        <div ref={guideRef} className={styles.cropGuide} style={{ aspectRatio: phoneAspect() }} />
      </div>
      <div className={styles.subpageActions}>
        <Button variant="outlined" size="m" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="m"
          onClick={() => {
            const dataUrl = cropToDataUrl()
            if (!dataUrl) {
              showToast({ key: 'chatBackgroundFailed', type: 'error' })
              return
            }
            onConfirm({ dataUrl })
          }}
        >
          {t('confirm')}
        </Button>
      </div>
    </div>
  )
}

/** 带数值的滑杆：用于背景发白程度 */
const RangeSlider = ({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) => (
  <label className={styles.sliderRow}>
    <span className={styles.sliderLabel}>{label}</span>
    <input
      className={styles.slider}
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
    <span className={styles.sliderValue}>{value}%</span>
  </label>
)
const AboutApp = () => {
  const t = useTranslate()
  const [contactOpen, setContactOpen] = useState(false)
  return (
    <div className={styles.about}>
      <img className={styles.aboutLogo} src={LOGO_DATA_URL} alt="" aria-hidden="true" />
      <div className={styles.aboutName}>DeepLook</div>
      <div className={styles.aboutVersion}>
        {t('settingsVersion')} {APP_VERSION}
      </div>
      <p className={styles.subpageHint}>{t('aboutDescription')}</p>
      <div className={styles.aboutCard}>
        <div className={styles.aboutRow}>
          <span>{t('aboutAuthor')}</span>
          <span className={styles.aboutValue}>HuaGyuu</span>
        </div>
        <div className={styles.aboutRow}>
          <span>{t('aboutGithub')}</span>
          <a
            className={styles.aboutLink}
            href="https://github.com/HuaGyuu/deeplook"
            onClick={(event) => {
              event.preventDefault()
              openExternalUrl('https://github.com/HuaGyuu/deeplook')
            }}
          >
            HuaGyuu/deeplook
          </a>
        </div>
        <div className={styles.aboutRow}>
          <span>{t('aboutContact')}</span>
          <button
            type="button"
            className={styles.aboutLink}
            onClick={() => setContactOpen(true)}
          >
            {t('contactAuthor')}
          </button>
        </div>
      </div>
      <UpdateChecker />
      {contactOpen ? (
        <Modal
          title={t('contactAuthor')}
          closable
          onClose={() => setContactOpen(false)}
          footer={
            <Button variant="outlined" size="m" onClick={() => setContactOpen(false)}>
              {t('close')}
            </Button>
          }
        >
          <div className={styles.contactQr}>
            <img src={WECHAT_QR_DATA_URL} alt={t('contactQrAlt')} />
            <p>{t('contactAuthorHint')}</p>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}


/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/** 从下载链接导入：原生下载 → 自动导入 → 删除临时文件 */
const ImportHistoryUrl = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)

  const start = async () => {
    if (busy || disabled) {
      return
    }
    if (!validateHistoryUrl(url)) {
      setStatus({ text: t('historyImportUrlInvalid'), error: true })
      return
    }
    setBusy(true)
    setPercent(0)
    setStatus({ text: t('historyImportUrlPreparing') })
    try {
      const count = await importHistoryFromUrl(url, (progress) => {
        setPercent(progress.percent)
        const key =
          progress.phase === 'downloading'
            ? 'historyImportPhaseDownloading'
            : progress.phase === 'reading'
              ? 'historyImportPhaseReading'
              : 'historyImportPhaseImporting'
        setStatus({ text: t(key, { percent: progress.percent }) })
      })
      setStatus({ text: t(count === 1 ? 'historyImportedOne' : 'historyImported', { count }) })
      setUrl('')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setStatus({
        text: message === 'cancelled' ? t('historyImportUrlCancelled') : t('historyImportUrlFailed'),
        error: true,
      })
    } finally {
      setBusy(false)
      setPercent(null)
    }
  }

  return (
    <div className={clsx(styles.cell, styles.urlImportCell)}>
      <div className={styles.text}>
        <div className={styles.label}>{t('historyImportUrl')}</div>
        <div className={clsx(styles.description, status?.error && styles.error)}>
          {status?.text ?? t('historyImportUrlDescription')}
        </div>
        {percent !== null ? (
          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className={styles.urlForm}>
        <input
          className={styles.urlInput}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('historyImportUrlPlaceholder')}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={disabled || busy}
        />
        <Button
          variant="outlined"
          size="m"
          className={clsx(styles.cellButton, styles.uploadButton)}
          disabled={disabled || busy}
          onClick={() => void start()}
        >
          {t('historyImportUrlImport')}
        </Button>
      </div>
    </div>
  )
}

const SettingCell = ({
  label,
  description,
  status,
  progress,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  progress?: number
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
        {progress !== undefined ? (
          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const importing = useRef(false)
  const progressRef = useRef(0)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    setProgress(null)
    progressRef.current = 0
    try {
      const count = await importHistory(file, (processed, total) => {
        const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0
        if (percent >= progressRef.current + 1 || percent === 100) {
          progressRef.current = percent
          setProgress(percent)
        }
      })
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
      setProgress(null)
    }
  }

  return { file, busy, status, progress, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={
        historyImport.busy
          ? historyImport.progress === null
            ? ({ key: 'historyImportPreparing' } as Status)
            : ({ key: 'historyImporting', params: { percent: historyImport.progress } } as Status)
          : historyImport.status
      }
      progress={historyImport.busy ? historyImport.progress ?? undefined : undefined}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
























