import { Check, Search, Server, Settings, X } from 'lucide-react'
import { useState } from 'react'
import type { Profile } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { Modal } from './ui/Modal'

interface Props {
  profiles: Profile[]
  currentProfileId: string
  onSelect: (id: string) => Promise<void>
  onManage: () => void
  onClose: () => void
}

export function ProfileSwitcher({
  profiles,
  currentProfileId,
  onSelect,
  onManage,
  onClose
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState('')
  const filtered = profiles.filter((profile) =>
    `${profile.label} ${profile.sshHost ?? profile.host} ${profile.user ?? ''}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  )
  const choose = async (id: string): Promise<void> => {
    if (pending) return
    setPending(id)
    setError('')
    try {
      await onSelect(id)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(undefined)
    }
  }
  return (
    <Modal
      label={t('profiles.title')}
      className="profile-switcher"
      onClose={onClose}
      dismissible={!pending}
    >
      <header className="modal-header">
        <div>
          <h2>{t('profiles.title')}</h2>
          <p>{t('profiles.description')}</p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          disabled={!!pending}
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>
      </header>
      <div className="profile-picker-content">
        <label className="sidebar-search profile-search">
          <Search size={15} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('profiles.search')}
            aria-label={t('profiles.search')}
          />
        </label>
        <div className="profile-options">
          {filtered.map((profile) => (
            <button
              key={profile.id}
              className={`profile-option ${profile.id === currentProfileId ? 'selected' : ''}`}
              onClick={() => void choose(profile.id)}
              disabled={!!pending}
              aria-pressed={profile.id === currentProfileId}
            >
              <Server size={18} />
              <span>
                <strong>{profile.label}</strong>
                <small>
                  {profile.sshHost ?? `${profile.user ? `${profile.user}@` : ''}${profile.host}`}
                </small>
              </span>
              {profile.id === currentProfileId && <Check size={17} />}
            </button>
          ))}
          {!filtered.length && <p className="muted">{t('profiles.noResults')}</p>}
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-footer">
        <button className="secondary-button" disabled={!!pending} onClick={onManage}>
          <Settings size={15} />
          {t('profiles.manage')}
        </button>
      </footer>
    </Modal>
  )
}
