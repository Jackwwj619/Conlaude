import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { Modal } from './ui/Modal'

export function EditTitleDialog({
  sessionName,
  title,
  onSave,
  onClose
}: {
  sessionName: string
  title?: string
  onSave: (title: string | undefined) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState(title || sessionName)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  return (
    <Modal className="small-modal title-edit-modal" label={t('work.editTitle')} onClose={onClose}>
      <header className="modal-header">
        <div>
          <h2>{t('work.editTitle')}</h2>
          <p>{t('work.titleBody')}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const next = draft.trim()
          onSave(next && next !== sessionName ? next : undefined)
          onClose()
        }}
      >
        <div className="modal-content title-edit-content">
          <div className="title-edit-original">
            <span>{t('work.originalTitle')}</span>
            <code>{sessionName}</code>
          </div>
          <label htmlFor="chat-title-input">{t('work.localTitle')}</label>
          <input
            ref={input}
            id="chat-title-input"
            autoFocus
            value={draft}
            maxLength={120}
            placeholder={sessionName}
            aria-describedby="chat-title-help"
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="title-edit-hint">
            <small id="chat-title-help">{t('work.titleResetHint')}</small>
            <small aria-hidden="true">{draft.length}/120</small>
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="primary-button" type="submit">
            {t('work.saveTitle')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
