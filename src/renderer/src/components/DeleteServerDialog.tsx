import { LoaderCircle, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Profile } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { Modal } from './ui/Modal'

export function DeleteServerDialog({
  profile,
  onDelete,
  onClose
}: {
  profile: Profile
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const remove = async (): Promise<void> => {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await onDelete(profile.id)
      onClose()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(reason)
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <Modal
      className="small-modal"
      label={t('library.delete')}
      onClose={onClose}
      dismissible={!pending}
    >
      <header className="modal-header">
        <div>
          <h2>{t('library.deleteTitle', { server: profile.label })}</h2>
          <p>{t('library.deleteBody')}</p>
        </div>
        <button
          className="icon-button"
          aria-label={t('common.close')}
          onClick={onClose}
          disabled={pending}
        >
          <X size={18} />
        </button>
      </header>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <footer className="modal-footer">
        <button className="secondary-button" onClick={onClose} disabled={pending}>
          {t('common.cancel')}
        </button>
        <button className="destructive-button" disabled={pending} onClick={() => void remove()}>
          {pending ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}
          {t('library.delete')}
        </button>
      </footer>
    </Modal>
  )
}
