import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { compressToNewChat } from '../../services/chat/compressFlow.js'
import { getContextPercent } from '../../services/chat/context.js'
import type { Session } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './CompressConfirm.module.css'

/**
 * 压缩确认：先说明压缩会做什么，再由用户确认。
 * 返回 request 供按钮打开弹窗，modal 由调用方渲染。
 */
export const useCompressConfirm = (session: Session, disabled = false) => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const title = t('compressedChatTitle', { title: session.title || t('untitledChat') })
  const percent = getContextPercent(session)

  const request = () => {
    if (!disabled) {
      setOpen(true)
    }
  }

  const close = () => {
    if (!busy) {
      setOpen(false)
    }
  }

  const confirm = async () => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      if (await compressToNewChat(session, title)) {
        showToast({ key: 'contextCompressed' })
        setOpen(false)
      } else {
        showToast({ key: 'compressFailed', type: 'error' })
      }
    } catch {
      showToast({ key: 'compressFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const modal = open ? (
    <Modal
      title={t('compressConfirmTitle')}
      closable={!busy}
      onClose={close}
      footer={
        <div className={styles.actions}>
          <Button variant="outlined" size="m" disabled={busy} autoFocus onClick={close}>
            {t('cancel')}
          </Button>
          <Button size="m" disabled={busy} onClick={() => void confirm()}>
            {t(busy ? 'compressing' : 'compressAndNewChat')}
          </Button>
        </div>
      }
    >
      <div className={styles.description}>{t('compressConfirmDescription')}</div>
      <div className={styles.usage}>{t('compressConfirmUsage', { percent })}</div>
      <div className={styles.note}>{t('compressConfirmNote')}</div>
    </Modal>
  ) : null

  return { request, modal, busy }
}
