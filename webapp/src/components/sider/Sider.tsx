import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCloseOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconSearchOutline16,
  IconSelectOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { openGlobalSearch } from '../globalSearch/globalSearchState.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { setPinnedSessions, usePinnedSessions } from '../../services/pins.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { useAccount } from '../../services/account.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { LOGO_DATA_URL } from '../../assets/logoData.js'
import { BalanceCard } from './BalanceCard.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 会话很多时首屏只渲染这么多，滚动到底再追加，避免一次渲染上千条卡顿 */
const SESSION_PAGE_SIZE = 60

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const account = useAccount()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const pinnedIds = usePinnedSessions((state) => state.ids)
  const groups = useMemo(() => {
    const pinnedSessions = pinnedIds
      .map((id) => sessions.find((session) => session.id === id))
      .filter((session): session is SessionSummary => session !== undefined)
    const rest = sessions.filter((session) => !pinnedIds.includes(session.id))
    const restGroups = groupSessions(rest, now, t)
    return pinnedSessions.length > 0
      ? [{ key: 'pinned', label: t('pinnedGroup'), sessions: pinnedSessions }, ...restGroups]
      : restGroups
  }, [sessions, pinnedIds, now, t])
  const [visibleCount, setVisibleCount] = useState(SESSION_PAGE_SIZE)
  // 会话数量变化（导入、删除）时回到首批
  useEffect(() => {
    setVisibleCount(SESSION_PAGE_SIZE)
  }, [sessions.length])
  const visibleGroups = useMemo(() => {
    if (sessions.length <= visibleCount) {
      return groups
    }
    let remaining = visibleCount
    const result: typeof groups = []
    for (const group of groups) {
      if (remaining <= 0) {
        break
      }
      const slice = group.sessions.slice(0, remaining)
      remaining -= slice.length
      if (slice.length > 0) {
        result.push({ ...group, sessions: slice })
      }
    }
    return result
  }, [groups, visibleCount, sessions.length])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  /** 多选删除：进入后点击会话切换选中，不再打开会话 */
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const toggleSelected = (id: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const allSelected = sessions.length > 0 && selectedIds.size >= sessions.length
  const allSelectedPinned =
    selectedIds.size > 0 && [...selectedIds].every((id) => pinnedIds.includes(id))
  /** 批量置顶：选中的已全部置顶时改为取消置顶 */
  const pinSelected = () => {
    const ids = [...selectedIds]
    if (ids.length === 0) {
      return
    }
    const unpin = ids.every((id) => pinnedIds.includes(id))
    setPinnedSessions(ids, !unpin)
    showToast({
      key: unpin ? 'sessionsUnpinned' : 'sessionsPinned',
      params: { count: ids.length },
    })
  }
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(sessions.map((session) => session.id)))
  }

  const exitSelect = () => {
    if (bulkDeleting) {
      return
    }
    setSelecting(false)
    setSelectedIds(new Set())
    setBulkConfirm(false)
  }

  /** 逐个删除，失败的计数后用 toast 说明 */
  const deleteSelected = async () => {
    const ids = [...selectedIds]
    if (ids.length === 0 || bulkDeleting) {
      return
    }
    setBulkDeleting(true)
    let failed = 0
    for (const id of ids) {
      if (!(await removeSession(id))) {
        failed += 1
      }
    }
    setBulkDeleting(false)
    setBulkConfirm(false)
    setSelecting(false)
    setSelectedIds(new Set())
    if (failed > 0) {
      showToast({ key: 'sessionsDeleteFailed', params: { count: failed }, type: 'error' })
    } else {
      showToast({ key: 'sessionsDeleted', params: { count: ids.length } })
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <img className={styles.brandLogo} src={LOGO_DATA_URL} alt="" aria-hidden="true" />
          <div className={styles.appName}>{t('appName')}</div>
        </div>
        <div className={styles.topActions}>
          <IconButton
            size="m"
            icon={<IconSearchOutline16 />}
            tooltip={t('globalSearchButton')}
            tooltipPlacement="bottom"
            onClick={() => {
              if (mobile) {
                closeMobileSider()
              }
              openGlobalSearch()
            }}
          />
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="bottom"
            onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
          />
        </div>
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}>
          <NewChatIcon />
        </span>
        {t('newChat')}
      </button>
      <BalanceCard />
      <div className={styles.listWrap}>
        <div
          className={styles.list}
          onScroll={(event) => {
            const element = event.currentTarget
            if (
              visibleCount < sessions.length &&
              element.scrollTop + element.clientHeight > element.scrollHeight - 240
            ) {
              setVisibleCount((count) => Math.min(sessions.length, count + SESSION_PAGE_SIZE))
            }
          }}
        >
          {selecting ? (
            <div className={styles.selectBar}>
              <span className={styles.selectedCount}>
                {t('selectedCount', { count: selectedIds.size })}
              </span>
              <button type="button" className={styles.toolbarAction} onClick={toggleSelectAll}>
                {allSelected ? t('clearSelection') : t('selectAll')}
              </button>
              <IconButton
                size="xs"
                icon={<IconPinOutline16 />}
                tooltip={allSelectedPinned ? t('unpinSession') : t('pinSession')}
                tooltipPlacement="bottom"
                disabled={selectedIds.size === 0}
                onClick={pinSelected}
              />
              <IconButton
                size="xs"
                icon={<IconCloseOutline16 />}
                tooltip={t('cancel')}
                tooltipPlacement="bottom"
                onClick={exitSelect}
              />
              <Button
                variant="danger"
                size="s"
                disabled={selectedIds.size === 0 || bulkDeleting}
                onClick={() => setBulkConfirm(true)}
              >
                {t(bulkDeleting ? 'deletingSessions' : 'delete')}
              </Button>
            </div>
          ) : null}
          {visibleGroups.map((group, index) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>{group.label}</span>
                {index === 0 && !selecting ? (
                  <IconButton
                    size="xs"
                    icon={<IconSelectOutline16 />}
                    tooltip={t('selectSessions')}
                    tooltipPlacement="bottom"
                    onClick={() => setSelecting(true)}
                  />
                ) : null}
              </div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  pinned={pinnedIds.includes(session.id)}
                  onDelete={() => setDeleting(session)}
                  selecting={selecting}
                  selected={selectedIds.has(session.id)}
                  onToggleSelect={() => toggleSelected(session.id)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => { if (mobile) closeMobileSider(); openSettings('general') }}>
          <span className={styles.settingsIcon}>
            {account.avatar ? (
              <img className={styles.settingsAvatar} src={account.avatar} alt="" />
            ) : account.loggedIn ? (
              <span className={styles.settingsInitial}>{Array.from(account.name || 'D')[0]}</span>
            ) : (
              <IconSettingsOutline16 />
            )}
          </span>
          <span className={styles.settingsLabel}>
            {account.loggedIn && account.name ? account.name : t('settings')}
          </span>
        </button>
      </div>
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {bulkConfirm ? (
        <Modal
          title={t('deleteSelectedTitle')}
          onClose={() => {
            if (!bulkDeleting) {
              setBulkConfirm(false)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={bulkDeleting} onClick={() => setBulkConfirm(false)}>
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={bulkDeleting} onClick={() => void deleteSelected()}>
                {t(bulkDeleting ? 'deletingSessions' : 'delete')}
              </Button>
            </>
          }
        >
          {t('deleteSelectedDescription', { count: selectedIds.size })}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭；关闭时保留一帧做滑出动画。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const dragging = useMobileSider((state) => state.dragging)
  const progress = useMobileSider((state) => state.progress)
  const visible = open || dragging || progress > 0
  const [rendered, setRendered] = useState(false)
  /** 是否已经进入展开态：先以收起态挂载，再开一帧展开，过渡动画才会真正播放 */
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (visible) {
      setRendered(true)
    } else {
      setEntered(false)
    }
  }, [visible])

  // 挂载后等两帧再展开，避免「一挂载就是最终态」导致没有进场动画
  useEffect(() => {
    if (!rendered || !visible || entered) {
      return
    }
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [rendered, visible, entered])

  // 收起动画结束后再真正卸载
  useEffect(() => {
    if (visible || !rendered) {
      return
    }
    const timer = setTimeout(() => setRendered(false), 300)
    return () => clearTimeout(timer)
  }, [visible, rendered])

  if (!rendered) {
    return null
  }
  // 拖动时抽屉直接跟随手指位置；松手后交给 CSS 过渡继续
  const shift = dragging ? (1 - Math.min(1, Math.max(0, progress))) * 100 : open ? 0 : 100
  return (
    <>
      <div
        className={clsx(styles.drawerMask, entered && !dragging && styles.drawerMaskOpen)}
        style={dragging ? { opacity: Math.min(1, Math.max(0, progress)) } : undefined}
        onClick={closeMobileSider}
      />
      <div
        className={clsx(styles.drawer, entered && !dragging && styles.drawerOpen)}
        style={
          dragging ? { transform: `translateX(-${shift}%)`, transition: 'none' } : undefined
        }
      >
        <Sider mobile />
      </div>
    </>
  )
}

