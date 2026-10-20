import {
  ArrowUpRight,
  Check,
  Folder,
  LayoutGrid,
  List,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  Upload
} from 'lucide-react'
import { useState } from 'react'
import type { AppSettings, Profile, SessionStatus } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { DeleteServerDialog } from './DeleteServerDialog'

interface Props {
  settings: AppSettings
  statuses: Record<string, SessionStatus>
  onOpen: (id: string) => Promise<void>
  onAdd: () => void
  onEdit: (profile: Profile) => void
  onDelete: (id: string) => Promise<void>
  onImport: () => Promise<void>
}

export function ServerLibrary({
  settings,
  statuses,
  onOpen,
  onAdd,
  onEdit,
  onDelete,
  onImport
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('clb:ui:server-view') === 'grid' ? 'grid' : 'list'
  )
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Profile>()
  const [onlineOnly, setOnlineOnly] = useState(false)
  const online = new Set(
    Object.values(statuses)
      .filter((status) => status.state === 'attached')
      .map((status) => status.profileId)
  )
  const filtered = settings.profiles.filter(
    (profile) =>
      (!onlineOnly || online.has(profile.id)) &&
      `${profile.label} ${profile.sshHost ?? profile.host} ${profile.defaultCwd}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim())
  )
  const perform = async (id: string, action: () => Promise<void>): Promise<void> => {
    setPending(id)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(reason)
      )
    } finally {
      setPending(undefined)
    }
  }
  return (
    <main className="server-library">
      <header className="library-topbar">
        <span>
          <Server size={16} /> {t('library.title')}
        </span>
        <span className="library-local-badge">
          <span /> {t('library.local')}
        </span>
      </header>
      <div className="library-scroll">
        <div className="library-heading">
          <div>
            <h1>{t('work.libraryTitle')}</h1>
            <p>{t('work.libraryBody')}</p>
          </div>
          <div className="library-actions">
            <button
              className="secondary-button"
              onClick={() => void perform('import', onImport)}
              disabled={!!pending}
            >
              {pending === 'import' ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Upload size={15} />
              )}
              {t('library.import')}
            </button>
            <button className="primary-button" onClick={onAdd} disabled={!!pending}>
              <Plus size={16} />
              {t('library.add')}
            </button>
          </div>
        </div>
        <div className="library-toolbar">
          <div className="library-filters">
            <button className={!onlineOnly ? 'active' : ''} onClick={() => setOnlineOnly(false)}>
              {t('library.all')}
              <span>{settings.profiles.length}</span>
            </button>
            <button className={onlineOnly ? 'active' : ''} onClick={() => setOnlineOnly(true)}>
              {t('library.connected')}
              <span>{online.size}</span>
            </button>
          </div>
          <label className="library-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('library.search')}
              aria-label={t('library.search')}
            />
            <kbd>⌕</kbd>
          </label>
          <div className="library-view-buttons" role="group" aria-label={t('library.view')}>
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                aria-label={t(`library.${mode}`)}
                aria-pressed={view === mode}
                onClick={() => {
                  setView(mode)
                  localStorage.setItem('clb:ui:server-view', mode)
                }}
              >
                {mode === 'grid' ? <LayoutGrid size={16} /> : <List size={17} />}
              </button>
            ))}
          </div>
        </div>
        {error && !deleteTarget && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className={`server-cards ${view}`}>
          {filtered.map((profile) => {
            const isOnline = online.has(profile.id)
            const endpoint =
              profile.sshHost ??
              `${profile.user ? `${profile.user}@` : ''}${profile.host}${profile.port === 22 ? '' : `:${profile.port}`}`
            return (
              <article className={`server-card ${isOnline ? 'online' : ''}`} key={profile.id}>
                <div className="server-card-top">
                  <div className="server-card-icon">
                    <Server size={21} />
                  </div>
                  <span className={`server-state ${isOnline ? 'online' : ''}`}>
                    <i />
                    {t(isOnline ? 'library.connected' : 'library.saved')}
                  </span>
                  <button
                    className="icon-button"
                    title={t('library.edit')}
                    aria-label={`${t('library.edit')} ${profile.label}`}
                    onClick={() => onEdit(profile)}
                    disabled={!!pending}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button server-delete"
                    title={t('library.delete')}
                    aria-label={`${t('library.delete')} ${profile.label}`}
                    disabled={!!pending}
                    onClick={() => {
                      setError('')
                      setDeleteTarget(profile)
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="server-card-identity">
                  <h2>{profile.label}</h2>
                  <p>
                    <span className="protocol-badge">SSH</span>
                    <code>{endpoint}</code>
                  </p>
                </div>
                <div className="server-card-directory" title={profile.defaultCwd}>
                  <Folder size={14} />
                  <span>{profile.defaultCwd}</span>
                </div>
                <footer>
                  <span>
                    <Check size={13} />
                    {profile.sshHost ? t('library.sshConfig') : t('library.manual')}
                  </span>
                  <button
                    className="server-connect"
                    onClick={() => void perform(profile.id, () => onOpen(profile.id))}
                    disabled={!!pending}
                  >
                    {pending === profile.id ? <LoaderCircle size={14} className="spin" /> : null}
                    {t('work.load')}
                    <ArrowUpRight size={15} />
                  </button>
                </footer>
              </article>
            )
          })}
          {!query && !onlineOnly && view === 'grid' && (
            <button className="server-add-card" onClick={onAdd} disabled={!!pending}>
              <span>
                <Plus size={24} />
              </span>
              <strong>{t('library.add')}</strong>
              <small>{t('library.addHint')}</small>
            </button>
          )}
        </div>
        {!settings.profiles.length && !query && !onlineOnly && (
          <div className="library-empty">
            <Server size={26} />
            <h2>{t('library.emptyTitle')}</h2>
            <p>{t('library.emptyBody')}</p>
          </div>
        )}
        {!filtered.length && (query || onlineOnly) && (
          <div className="library-empty">
            <Search size={26} />
            <h2>{t('profiles.noResults')}</h2>
            <p>{t('library.emptyHint')}</p>
          </div>
        )}
        <div className="library-bottom-note">
          <span className="library-note-icon">
            <SquareIcon />
          </span>
          <div>
            <strong>{t('library.persistentTitle')}</strong>
            <p>{t('library.persistentBody')}</p>
          </div>
          <kbd>Ctrl + `</kbd>
        </div>
      </div>
      {deleteTarget && (
        <DeleteServerDialog
          profile={deleteTarget}
          onDelete={onDelete}
          onClose={() => setDeleteTarget(undefined)}
        />
      )}
    </main>
  )
}

function SquareIcon(): React.JSX.Element {
  return <Server size={19} />
}
