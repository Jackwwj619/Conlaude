import { TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { Modal } from './ui/Modal'

interface Props {
  action: 'rename' | 'terminate'
  target: SessionTarget
  onClose: () => void
  onRename: (newName: string) => Promise<void>
  onTerminate: (confirmation: string) => Promise<void>
}

export function SessionActionDialog({
  action,
  target,
  onClose,
  onRename,
  onTerminate
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [value, setValue] = useState(action === 'rename' ? target.sessionName : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (action === 'rename') await onRename(value)
      else await onTerminate(value)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const valid =
    action === 'rename'
      ? /^[A-Za-z0-9_.-]{1,64}$/.test(value) && value !== target.sessionName
      : value === target.sessionName

  return (
    <Modal
      className="small-modal session-action-modal"
      label={action === 'rename' ? t('session.renameLabel') : t('session.terminateLabel')}
      onClose={onClose}
      dismissible={!busy}
    >
      <header className="modal-header">
        <div>
          <h2>{action === 'rename' ? t('session.renameTitle') : t('session.terminateTitle')}</h2>
          <p>{action === 'rename' ? t('session.renameBody') : t('session.terminateBody')}</p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>
      </header>
      <div className="modal-content form-grid">
        {action === 'terminate' && (
          <div className="danger-callout wide">
            <TriangleAlert size={18} />
            <span>{t('session.confirm', { session: target.sessionName })}</span>
          </div>
        )}
        <label className="wide">
          {action === 'rename' ? t('session.newName') : t('session.confirmName')}
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) void submit()
            }}
          />
        </label>
        {error && (
          <p className="error-banner wide" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="secondary-button" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          className={action === 'terminate' ? 'destructive-button' : 'primary-button'}
          onClick={() => void submit()}
          disabled={!valid || busy}
        >
          {busy
            ? t('session.busy')
            : action === 'rename'
              ? t('session.saveName')
              : t('session.terminateTitle')}
        </button>
      </footer>
    </Modal>
  )
}
