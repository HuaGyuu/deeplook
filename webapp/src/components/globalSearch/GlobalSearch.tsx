import { useEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { searchAllSessions, type GlobalSearchHit } from '../../services/chat/search.js'
import { selectSession } from '../../services/chat/store.js'
import { formatDate } from '../../utils/format.js'
import { IconCloseOutline16, IconSearchOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeMobileSider } from '../sider/mobileSiderState.js'
import { closeGlobalSearch, setSearchTarget, useGlobalSearch } from './globalSearchState.js'
import styles from './GlobalSearch.module.css'

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

const formatWhen = (time: number) => {
  const diff = Math.floor((Date.now() - startOfDay(time)) / 86_400_000)
  if (diff <= 0) {
    return '今天'
  }
  if (diff <= 1) {
    return '昨天'
  }
  const date = formatDate(time)
  if (!date) {
    return ''
  }
  const [, month, day] = date.split('-')
  return `${Number(month)}月${Number(day)}日`
}

const Highlight = ({ text, query }: { text: string; query: string }) => {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (index < 0) {
    return <>{text}</>
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className={styles.mark}>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  )
}

/** 全局对话搜索：搜索标题与所有会话内容，结果点击后打开对应会话。 */
export const GlobalSearch = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const open = useGlobalSearch((state) => state.open)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<GlobalSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setSearching(false)
      return
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const keyword = query.trim()
    if (!keyword) {
      setHits([])
      setSearching(false)
      return
    }
    const controller = new AbortController()
    setSearching(true)
    const timer = window.setTimeout(() => {
      void searchAllSessions(keyword, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setHits(result)
            setSearching(false)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearching(false)
          }
        })
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  if (!open) {
    return null
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={t('globalSearchPlaceholder')}>
      <div className={styles.panel}>
        <div className={styles.searchBar}>
          <IconSearchOutline16 />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            placeholder={t('globalSearchPlaceholder')}
            aria-label={t('globalSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <IconButton
            icon={<IconCloseOutline16 />}
            aria-label={t('close')}
            onClick={closeGlobalSearch}
          />
        </div>
        <div className={styles.status} aria-live="polite">
          {searching
            ? t('globalSearching')
            : query.trim()
              ? hits.length > 0
                ? t('globalSearchResults', { count: hits.length })
                : t('globalSearchNoResults')
              : t('globalSearchHint')}
        </div>
        <div className={styles.results}>
          {hits.map((hit) => (
            <button
              key={hit.key}
              type="button"
              className={styles.hit}
              onClick={() => {
                setSearchTarget({ sessionId: hit.sessionId, messageId: hit.messageId })
                selectSession(hit.sessionId)
                closeGlobalSearch()
                if (isMobile) {
                  closeMobileSider()
                }
              }}
            >
              <span className={styles.hitIcon}>
                <IconSearchOutline16 />
              </span>
              <span className={styles.hitBody}>
                <span className={styles.hitTitle}>{hit.title}</span>
                <span className={styles.hitSnippet}>
                  <Highlight text={hit.snippet} query={query.trim()} />
                </span>
              </span>
              <span className={styles.hitDate}>{formatWhen(hit.updatedAt)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
