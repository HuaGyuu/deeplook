import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { fetchBalance, type BalanceInfo } from '../../services/balance.js'
import { openExternalUrl } from '../../services/externalLink.js'
import { useSettings } from '../../services/settings.js'
import styles from './BalanceCard.module.css'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

const pickBalance = (items: BalanceInfo[] | undefined): BalanceInfo | null => {
  if (!items || items.length === 0) {
    return null
  }
  return items.find((item) => item.currency === 'CNY') ?? items[0]
}

const formatBalance = (info: BalanceInfo): string => {
  const amount = info.total_balance ?? '--'
  if (info.currency === 'USD') {
    return `$${amount}`
  }
  return `¥${amount}`
}

/** 侧边栏余额卡：左侧查询人民币余额，右侧打开 DeepSeek 充值页。 */
export const BalanceCard = () => {
  const t = useTranslate()
  const apiKey = useSettings((state) => state.apiKey)
  const [balance, setBalance] = useState<BalanceInfo | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!apiKey?.trim()) {
      setBalance(null)
      setStatus('idle')
      return
    }
    const controller = new AbortController()
    const load = () => {
      setStatus('loading')
      void fetchBalance(apiKey, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) {
            return
          }
          const info = pickBalance(response.balance_infos)
          setBalance(info)
          setStatus(info ? 'ready' : 'error')
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setStatus('error')
          }
        })
    }
    load()
    // 回到前台时刷新一次，充值或消费后余额能及时更新
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        load()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [apiKey])

  return (
    <div className={styles.card} aria-live="polite">
      <div className={styles.left}>
        <span className={styles.label}>{t('balanceLabel')}</span>
        <span className={styles.amount}>
          {status === 'loading' ? t('balanceLoading') : null}
          {status === 'ready' && balance ? formatBalance(balance) : null}
          {status === 'idle' ? t('balanceNoKey') : null}
          {status === 'error' ? t('balanceUnavailable') : null}
        </span>
      </div>
      <a
        className={styles.topUp}
        href={TOP_UP_URL}
        onClick={(event) => {
          event.preventDefault()
          openExternalUrl(TOP_UP_URL)
        }}
      >
        {t('topUp')}
      </a>
    </div>
  )
}

