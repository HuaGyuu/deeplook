import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { selectPersona, selectUserPersona, usePersonas } from '../../services/personas.js'
import { Modal } from '../base/Modal.js'
import { IconPersonOutline16 } from '../base/icons.js'
import styles from './PersonaPicker.module.css'

/** 新对话上方的悬浮按钮：先选 AI 人设，再选它对应的用户人设 */
export const PersonaPicker = () => {
  const t = useTranslate()
  const personas = usePersonas((state) => state.personas)
  const selectedId = usePersonas((state) => state.selectedId)
  const selectedUserId = usePersonas((state) => state.selectedUserId)
  const [open, setOpen] = useState(false)
  /** 选完 AI 人设后进入用户人设选择步骤 */
  const [step, setStep] = useState<'ai' | 'user'>('ai')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const selected = personas.find((item) => item.id === selectedId) ?? null
  const pending = personas.find((item) => item.id === pendingId) ?? null
  const pickedUser = selected?.userPersonas.find((item) => item.id === selectedUserId) ?? null

  const close = () => {
    setOpen(false)
    setStep('ai')
    setPendingId(null)
  }

  const choosePersona = (id: string | null) => {
    selectPersona(id)
    const persona = id === null ? null : personas.find((item) => item.id === id)
    if (persona && persona.userPersonas.length > 0) {
      setPendingId(persona.id)
      setStep('user')
      return
    }
    close()
  }

  const chooseUserPersona = (userId: string | null) => {
    selectUserPersona(userId)
    close()
  }

  const triggerText = selected
    ? pickedUser
      ? `${selected.name} · ${pickedUser.name}`
      : selected.name
    : t('personaPickerEntry')

  return (
    <>
      <button
        type="button"
        className={clsx(styles.trigger, selected && styles.triggerActive)}
        aria-label={t('personaSelectTitle')}
        onClick={() => {
          setStep('ai')
          setOpen(true)
        }}
      >
        <span className={styles.triggerIcon}>
          {selected?.cover ? <img src={selected.cover} alt="" /> : <IconPersonOutline16 />}
        </span>
        <span className={styles.triggerText}>{triggerText}</span>
      </button>
      {open && step === 'ai' ? (
        <Modal title={t('personaSelectTitle')} closable onClose={close}>
          <p className={styles.hint}>{t('personaSelectHint')}</p>
          <div className={styles.list}>
            <button
              type="button"
              className={clsx(styles.option, selectedId === null && styles.optionActive)}
              onClick={() => choosePersona(null)}
            >
              <span className={clsx(styles.cover, styles.coverEmpty)}>{t('personaNoneShort')}</span>
              <span className={styles.optionText}>{t('personaNoPersona')}</span>
            </button>
            {personas.map((persona) => (
              <button
                key={persona.id}
                type="button"
                className={clsx(styles.option, persona.id === selectedId && styles.optionActive)}
                onClick={() => choosePersona(persona.id)}
              >
                <span className={styles.cover}>
                  {persona.cover ? (
                    <img src={persona.cover} alt="" />
                  ) : (
                    <span className={styles.coverText}>{persona.name.slice(0, 4) || '人设'}</span>
                  )}
                </span>
                <span className={styles.optionText}>{persona.name}</span>
              </button>
            ))}
          </div>
          {personas.length === 0 ? <p className={styles.empty}>{t('personaEmptyHint')}</p> : null}
        </Modal>
      ) : null}
      {open && step === 'user' && pending ? (
        <Modal title={t('personaUserPickTitle')} closable onClose={close}>
          <p className={styles.hint}>{t('personaUserPickHint')}</p>
          <div className={styles.list}>
            <button
              type="button"
              className={clsx(styles.option, selectedUserId === null && styles.optionActive)}
              onClick={() => chooseUserPersona(null)}
            >
              <span className={clsx(styles.cover, styles.coverEmpty)}>{t('personaNoneShort')}</span>
              <span className={styles.optionText}>{t('personaUserNone')}</span>
            </button>
            {pending.userPersonas.map((user) => (
              <button
                key={user.id}
                type="button"
                className={clsx(
                  styles.option,
                  user.id === (selectedUserId ?? pending.defaultUserPersonaId) && styles.optionActive
                )}
                onClick={() => chooseUserPersona(user.id)}
              >
                <span className={styles.cover}>
                  <span className={styles.coverText}>{user.name.slice(0, 4) || '我'}</span>
                </span>
                <span className={styles.optionText}>{user.name}</span>
              </button>
            ))}
          </div>
          <p className={styles.empty}>{pending.name}</p>
        </Modal>
      ) : null}
    </>
  )
}
