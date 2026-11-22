import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { LOGO_DATA_URL } from '../../assets/logoData.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import { PersonaPicker } from '../persona/PersonaPicker.js'
import styles from './Welcome.module.css'

/** 新对话：应用图标 + 问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <img className={styles.logo} src={LOGO_DATA_URL} alt="" aria-hidden="true" />
          <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        </div>
        {/* 只有新对话才显示人设悬浮按钮 */}
        <div className={styles.personaBar}>
          <PersonaPicker />
        </div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
