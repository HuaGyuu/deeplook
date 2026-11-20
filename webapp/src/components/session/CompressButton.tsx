import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { compressToNewChat } from '../../services/chat/compressFlow.js'
import type { Session } from '../../services/chat/types.js'
import { IconCompressOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { showToast } from '../base/toastState.js'

/** 顶栏的压缩上下文按钮：压缩当前会话并开启新会话。 */
export const CompressButton = ({
  session,
  size = 'm',
  disabled = false,
}: {
  session: Session
  size?: 'm' | 'xl'
  disabled?: boolean
}) => {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const label = busy ? t('compressing') : t('compressContext')
  const title = t('compressedChatTitle', { title: session.title || t('untitledChat') })
  return (
    <IconButton
      size={size}
      tone="primary"
      icon={<IconCompressOutline16 />}
      tooltip={label}
      aria-label={label}
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
    />
  )
}
