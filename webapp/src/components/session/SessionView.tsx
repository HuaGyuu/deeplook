import clsx from 'clsx'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { CompressButton } from './CompressButton.js'
import { IconCallOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { openVoiceCall } from '../voiceCall/voiceCallState.js'
import { ContextBanner } from './ContextBanner.js'
import { MessageList } from '../messages/MessageList.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './SessionView.module.css'

/** 会话页：标题栏（移动端为顶栏）+ 消息列表，输入框吸底 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
  targetMessageId,
  onTargetReached,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
  targetMessageId?: string
  onTargetReached?: () => void
}) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      {isMobile ? (
        <MobileHeader title={title} session={session} />
      ) : (
        <div className={styles.header}>
          <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
            {title}
          </div>
          <div className={styles.headerActions}>
            <IconButton
              size="m"
              tone="primary"
              icon={<IconCallOutline16 />}
              tooltip={t('voiceCallEntry')}
              aria-label={t('voiceCallEntry')}
              onClick={openVoiceCall}
            />
            <CompressButton session={session} disabled={streaming} />
          </div>
        </div>
      )}
      <MessageList
        session={session}
        streaming={streaming}
        targetMessageId={targetMessageId}
        onTargetReached={onTargetReached}
        footer={
          <div className={styles.inputContainer}>
            <ContextBanner session={session} disabled={streaming} />
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}

