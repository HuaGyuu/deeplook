import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import styles from './FirstRunNotice.module.css'

const STORAGE_KEY = 'deeplook-privacy-accepted'

/** 首次启动的隐私/安全说明：只在第一次打开时出现一次 */
export const FirstRunNotice = () => {
  const t = useTranslate()
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '1'
    } catch {
      return true
    }
  })

  if (!visible) {
    return null
  }

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // 存储不可用时只在本次会话隐藏
    }
    setVisible(false)
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('privacyTitle')}>
      <div className={styles.card}>
        <div className={styles.logo}>DeepLook</div>
        <h1 className={styles.title}>{t('privacyTitle')}</h1>
        <p className={styles.subtitle}>{t('privacySubtitle')}</p>
        <ul className={styles.list}>
          <li className={styles.item}>
            <span className={styles.dot} aria-hidden />
            <span>
              <b>{t('privacyLocalTitle')}</b>
              {t('privacyLocalBody')}
            </span>
          </li>
          <li className={styles.item}>
            <span className={styles.dot} aria-hidden />
            <span>
              <b>{t('privacyTrackTitle')}</b>
              {t('privacyTrackBody')}
            </span>
          </li>
          <li className={styles.item}>
            <span className={styles.dot} aria-hidden />
            <span>
              <b>{t('privacyCredentialTitle')}</b>
              {t('privacyCredentialBody')}
            </span>
          </li>
          <li className={styles.item}>
            <span className={styles.dot} aria-hidden />
            <span>
              <b>{t('privacyDirectTitle')}</b>
              {t('privacyDirectBody')}
            </span>
          </li>
          <li className={styles.item}>
            <span className={styles.dot} aria-hidden />
            <span>
              <b>{t('privacyOpenSourceTitle')}</b>
              {t('privacyOpenSourceBody')}
            </span>
          </li>
        </ul>
        <p className={styles.note}>{t('privacyThirdPartyNote')}</p>
        <Button variant="primary" className={styles.action} onClick={accept}>
          {t('privacyAccept')}
        </Button>
      </div>
    </div>
  )
}
