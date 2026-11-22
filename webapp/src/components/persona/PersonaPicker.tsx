import clsx from 'clsx'
import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { usePersonas, selectPersona } from '../../services/personas.js'
import { Modal } from '../base/Modal.js'
import { IconPersonOutline16 } from '../base/icons.js'
import styles from './PersonaPicker.module.css'

/** 新对话上方的悬浮按钮：选一个 AI 人设，注入这次会话的系统提示 */
export const PersonaPicker = () => {
  const t = useTranslate()
  const personas = usePersonas((state) => state.personas)
  const selectedId = usePersonas((state) => state.selectedId)
  const [open, setOpen] = useState(false)
  const selected = personas.find((item) => item.id === selectedId) ?? null

  return (
    <>
      <button
        type="button"
        className={clsx(styles.trigger, selected && styles.triggerActive)}
        aria-label={t('personaSelectTitle')}
        onClick={() => setOpen(true)}
      >
        <span className={styles.triggerIcon}>
          {selected?.cover ? <img src={selected.cover} alt="" /> : <IconPersonOutline16 />}
        </span>
        <span className={styles.triggerText}>{selected?.name ?? t('personaPickerEntry')}</span>
      </button>
      {open ? (
        <Modal title={t('personaSelectTitle')} closable onClose={() => setOpen(false)}>
          <p className={styles.hint}>{t('personaSelectHint')}</p>
          <div className={styles.list}>
            <button
              type="button"
              className={clsx(styles.option, selectedId === null && styles.optionActive)}
              onClick={() => {
                selectPersona(null)
                setOpen(false)
              }}
            >
              <span className={clsx(styles.cover, styles.coverEmpty)}>{t('personaNoneShort')}</span>
              <span className={styles.optionText}>{t('personaNoPersona')}</span>
            </button>
            {personas.map((persona) => (
              <button
                key={persona.id}
                type="button"
                className={clsx(styles.option, persona.id === selectedId && styles.optionActive)}
                onClick={() => {
                  selectPersona(persona.id)
                  setOpen(false)
                }}
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
    </>
  )
}
