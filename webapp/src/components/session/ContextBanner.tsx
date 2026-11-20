import { useTranslate } from '../../i18n/index.js'
import { getContextPercent } from '../../services/chat/context.js'
import type { Session } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { useCompressConfirm } from './CompressConfirm.js'
import styles from './ContextBanner.module.css'

/** 上下文达到 80% 后提示压缩；点击只打开确认说明，不直接压缩。 */
export const ContextBanner = ({ session, disabled = false }: { session: Session; disabled?: boolean }) => {
  const t = useTranslate()
  const confirm = useCompressConfirm(session, disabled)
  const percent = getContextPercent(session)
  if (percent < 80) {
    return session.summary ? <div className={styles.notice}>{t('contextCompressedNotice')}</div> : null
  }
  const message = percent >= 100 ? t('contextFull') : t('contextUsage', { percent })
  return (
    <>
      <div className={styles.banner} role="status" aria-live="polite">
        <span className={styles.text}>{confirm.busy ? t('compressing') : message}</span>
        <Button
          variant="outlined"
          size="s"
          disabled={disabled || confirm.busy}
          onClick={confirm.request}
        >
          {confirm.busy ? t('compressing') : t('compressContext')}
        </Button>
      </div>
      {confirm.modal}
    </>
  )
}
