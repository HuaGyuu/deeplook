import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { getContextPercent } from '../../services/chat/context.js'
import { compressToNewChat } from '../../services/chat/compressFlow.js'
import type { Session } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './ContextBanner.module.css'

/** 上下文达到 80% 后提示压缩；点击直接压缩并开启新会话。 */
export const ContextBanner = ({ session, disabled = false }: { session: Session; disabled?: boolean }) => {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const percent = getContextPercent(session)
  if (percent < 80) {
    return session.summary ? <div className={styles.notice}>{t('contextCompressedNotice')}</div> : null
  }
  const title = t('compressedChatTitle', { title: session.title || t('untitledChat') })
  const message = percent >= 100 ? t('contextFull') : t('contextUsage', { percent })
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <span className={styles.text}>{busy ? t('compressing') : message}</span>
      <Button
        variant="outlined"
        size="s"
        disabled={disabled || busy}
        onClick={async () => {
          if (busy) {
            return
          }
          setBusy(true)
          try {
            if (await compressToNewChat(session, title)) {
              showToast({ key: 'contextCompressed' })
            } else {
              showToast({ key: 'compressFailed', type: 'error' })
            }
          } catch {
            showToast({ key: 'compressFailed', type: 'error' })
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? t('compressing') : t('compressContext')}
      </Button>
    </div>
  )
}

