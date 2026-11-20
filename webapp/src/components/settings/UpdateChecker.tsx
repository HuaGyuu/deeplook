import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { APP_VERSION } from '../../services/appVersion.js'
import {
  checkLatestRelease,
  downloadAndInstall,
  isNewerVersion,
  type LatestRelease,
} from '../../services/update.js'
import { Button } from '../base/Button.js'
import styles from './UpdateChecker.module.css'

type UpdateState =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'permission'
  | 'installing'
  | 'error'

/** 关于页的检查更新：检查 GitHub 最新 Release，Android 上可下载并拉起安装器。 */
export const UpdateChecker = () => {
  const t = useTranslate()
  const [state, setState] = useState<UpdateState>('idle')
  const [release, setRelease] = useState<LatestRelease | null>(null)
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  const unsubscribeRef = useRef<() => void>(() => {})

  useEffect(() => () => unsubscribeRef.current(), [])

  const check = async () => {
    if (state === 'checking' || state === 'downloading') {
      return
    }
    setState('checking')
    setMessage('')
    try {
      const latest = await checkLatestRelease()
      setRelease(latest)
      setState(isNewerVersion(latest.version) ? 'available' : 'latest')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const install = () => {
    if (!release || state === 'downloading') {
      return
    }
    setState('downloading')
    setPercent(0)
    unsubscribeRef.current()
    unsubscribeRef.current = downloadAndInstall(release, (event) => {
      if (event.type !== 'download') {
        return
      }
      if (event.status === 'downloading') {
        setState('downloading')
        setPercent(event.percent ?? 0)
      } else if (event.status === 'permission') {
        setState('permission')
      } else if (event.status === 'installing' || event.status === 'ready') {
        setState('installing')
      } else if (event.status === 'error') {
        setState('error')
        setMessage(event.message ?? '')
      } else if (event.status === 'external') {
        setState('available')
      }
    })
  }

  const busy = state === 'checking' || state === 'downloading'
  return (
    <div className={styles.box}>
      <div className={styles.versionRow}>
        <span>{t('currentVersion')}</span>
        <span className={styles.version}>{APP_VERSION}</span>
      </div>
      <div className={styles.actions}>
        <Button variant="outlined" size="m" disabled={busy} onClick={() => void check()}>
          {t(state === 'checking' ? 'checkingUpdate' : 'checkUpdate')}
        </Button>
        {state === 'available' ? (
          <Button size="m" onClick={install}>
            {t('downloadAndInstall')}
          </Button>
        ) : null}
      </div>
      <div className={styles.status} role="status" aria-live="polite">
        {state === 'latest' ? t('upToDate') : null}
        {state === 'available' && release
          ? t('newVersionAvailable', { version: release.version })
          : null}
        {state === 'downloading' ? t('downloadingUpdate', { percent }) : null}
        {state === 'permission' ? t('updatePermission') : null}
        {state === 'installing' ? t('updateInstalling') : null}
        {state === 'error' ? `${t('updateFailed')}${message ? `：${message}` : ''}` : null}
      </div>
    </div>
  )
}
