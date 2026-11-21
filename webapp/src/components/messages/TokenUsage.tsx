import { useTranslate } from '../../i18n/index.js'
import type { MessageUsage } from '../../services/api/types.js'
import styles from './TokenUsage.module.css'

const formatNumber = (value: number) => value.toLocaleString('en-US')

/** 单轮对话的 token 用量：输入（含缓存）与输出；无 usage 的导入历史不显示 */
export const TokenUsage = ({ usage }: { usage?: MessageUsage }) => {
  const t = useTranslate()
  if (!usage) {
    return null
  }
  const input =
    usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens
  const output = usage.output_tokens
  if (input <= 0 && output <= 0) {
    return null
  }
  return (
    <span
      className={styles.usage}
      title={t('tokenUsageTitle', {
        input: formatNumber(input),
        output: formatNumber(output),
        cached: formatNumber(usage.cache_read_input_tokens),
      })}
    >
      {t('tokenUsage', { input: formatNumber(input), output: formatNumber(output) })}
    </span>
  )
}
