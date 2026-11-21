import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import type { MessageUsage } from '../../services/api/types.js'
import styles from './TokenUsage.module.css'

const formatNumber = (value: number) => value.toLocaleString('en-US')

/**
 * 单轮对话的 token 用量：点击弹出明细（缓存写入/命中、未命中输入、输出、合计）。
 * 没有 usage 的导入历史不显示。
 */
export const TokenUsage = ({ usage }: { usage?: MessageUsage }) => {
  const t = useTranslate()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const button = buttonRef.current
    const popover = popoverRef.current
    if (!button || !popover) {
      return
    }
    const rect = button.getBoundingClientRect()
    const size = popover.getBoundingClientRect()
    const margin = 8
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - size.width / 2),
      window.innerWidth - size.width - margin
    )
    // 优先放在文字上方，空间不足时放到下方
    const above = rect.top - size.height - 6
    const top = above < margin ? Math.min(rect.bottom + 6, window.innerHeight - size.height - margin) : above
    setPosition({ left, top })
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  if (!usage) {
    return null
  }
  const cached = usage.cache_read_input_tokens
  const written = usage.cache_creation_input_tokens
  const uncached = usage.input_tokens
  const input = uncached + written + cached
  const output = usage.output_tokens
  // 缓存命中率：命中部分占全部输入的比例
  const hitRate = input > 0 ? Math.round((cached / input) * 100) : 0
  if (input <= 0 && output <= 0) {
    return null
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.usage}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('tokenUsageDetailHint')}
        onClick={() => setOpen((value) => !value)}
      >
        {t('tokenUsage', { input: formatNumber(input), output: formatNumber(output) })}
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className={styles.popover}
              role="dialog"
              aria-label={t('tokenUsageDetailTitle')}
              style={position ? { left: position.left, top: position.top } : { visibility: 'hidden' }}
            >
              <div className={styles.popoverTitle}>{t('tokenUsageDetailTitle')}</div>
              <dl className={styles.rows}>
                <div className={styles.row}>
                  <dt>{t('tokenUsageCached')}</dt>
                  <dd>{formatNumber(cached)}</dd>
                </div>
                <div className={styles.row}>
                  <dt>{t('tokenUsageCacheWrite')}</dt>
                  <dd>{formatNumber(written)}</dd>
                </div>
                <div className={styles.row}>
                  <dt>{t('tokenUsageUncached')}</dt>
                  <dd>{formatNumber(uncached)}</dd>
                </div>
                <div className={styles.row}>
                  <dt>{t('tokenUsageOutput')}</dt>
                  <dd>{formatNumber(output)}</dd>
                </div>
                <div className={`${styles.row} ${styles.totalRow}`}>
                  <dt>{t('tokenUsageTotal')}</dt>
                  <dd>{formatNumber(input + output)}</dd>
                </div>
                <div className={styles.row}>
                  <dt>{t('tokenUsageHitRate')}</dt>
                  <dd>{`${hitRate}%`}</dd>
                </div>
              </dl>
              <p className={styles.popoverNote}>{t('tokenUsageNote')}</p>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

