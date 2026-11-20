import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { IconCompressOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { useCompressConfirm } from './CompressConfirm.js'

/** 顶栏的压缩上下文按钮：先弹出说明和确认，不直接压缩。 */
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
  const confirm = useCompressConfirm(session, disabled)
  return (
    <>
      <IconButton
        size={size}
        tone="primary"
        icon={<IconCompressOutline16 />}
        tooltip={t('compressContext')}
        aria-label={t('compressContext')}
        disabled={disabled || confirm.busy}
        onClick={confirm.request}
      />
      {confirm.modal}
    </>
  )
}
