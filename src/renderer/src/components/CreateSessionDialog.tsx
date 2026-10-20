import { FolderOpen, LoaderCircle, X } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  CreateSessionRequestSchema,
  type CreateSessionRequest,
  type Profile
} from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { RemoteDirectoryPicker } from './RemoteDirectoryPicker'
import { Modal } from './ui/Modal'
import '../create-session.css'

interface Props {
  profiles: Profile[]
  initialProfileId: string
  onClose: () => void
  onCreate: (request: CreateSessionRequest, title?: string) => Promise<void>
}

export function CreateSessionDialog({
  profiles,
  initialProfileId,
  onClose,
  onCreate
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [profileId, setProfileId] = useState(initialProfileId)
  const [suffix] = useState(() => Date.now().toString(36))
  const [drafts, setDrafts] = useState<Record<string, { name: string; cwd: string }>>({})
  const [title, setTitle] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState('')
  const profile = profiles.find((item) => item.id === profileId)
  const draft = drafts[profileId] ?? {
    name: `${(profile?.defaultSession || 'claude').slice(0, 63 - suffix.length)}-${suffix}`,
    cwd: profile?.defaultCwd ?? '~'
  }
  const update = (patch: Partial<typeof draft>): void => {
    setDrafts((previous) => ({ ...previous, [profileId]: { ...draft, ...patch } }))
    setError('')
  }
  const parsed = CreateSessionRequestSchema.safeParse({
    profileId,
    sessionName: draft.name.trim(),
    cwd: draft.cwd.trim()
  })
  const valid = !!profile && parsed.success && !draft.cwd.includes('\0')
  const create = async (): Promise<void> => {
    if (locked.current || !valid || !parsed.success) return
    locked.current = true
    setCreating(true)
    setError('')
    try {
      await onCreate(parsed.data, title.trim())
      onClose()
    } catch (reason) {
      setError(
        (reason instanceof Error ? reason.message : String(reason)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          ''
        )
      )
    } finally {
      locked.current = false
      setCreating(false)
    }
  }

  return (
    <Modal
      className="small-modal create-session-modal"
      label={t('create.label')}
      onClose={onClose}
      dismissible={!creating}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <header className="modal-header">
          <div>
            <h2>{t('create.title')}</h2>
            <p>{t('work.newBody')}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={creating}
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-content form-grid">
          <div className="wide create-directory-field">
            <label htmlFor="create-server">{t('create.server')}</label>
            <select
              id="create-server"
              autoFocus
              value={profileId}
              disabled={creating}
              onChange={(event) => {
                setProfileId(event.target.value)
                setError('')
              }}
            >
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.sshHost || item.host}
                </option>
              ))}
            </select>
          </div>
          <div className="wide create-directory-field">
            <label htmlFor="create-cwd">{t('create.cwd')}</label>
            <div className="create-directory-input">
              <input
                id="create-cwd"
                value={draft.cwd}
                maxLength={4096}
                required
                disabled={creating}
                placeholder="~/projects/my-project"
                onChange={(event) => {
                  update({ cwd: event.target.value })
                  setBrowsing(false)
                }}
              />
              <button
                type="button"
                className="secondary-button"
                disabled={creating || !profile}
                aria-expanded={browsing}
                aria-controls="create-directory-browser"
                onClick={() => setBrowsing((open) => !open)}
              >
                <FolderOpen size={15} />
                {t('create.browse')}
              </button>
            </div>
            <small>{t('create.cwdHint')}</small>
            {browsing && profile && (
              <RemoteDirectoryPicker
                key={profile.id}
                profileId={profile.id}
                initialPath={draft.cwd.trim() || '~'}
                disabled={creating}
                onSelect={(cwd) => {
                  update({ cwd })
                  setBrowsing(false)
                }}
              />
            )}
          </div>
          <div className="wide create-directory-field">
            <label htmlFor="create-session-name">{t('create.name')}</label>
            <input
              id="create-session-name"
              value={draft.name}
              maxLength={64}
              required
              disabled={creating}
              aria-describedby="create-name-hint"
              onChange={(event) => update({ name: event.target.value })}
            />
            <small id="create-name-hint">{t('create.nameHint')}</small>
          </div>
          <label className="wide">
            {t('work.title')}
            <input
              value={title}
              maxLength={120}
              disabled={creating}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('work.titleHint')}
            />
          </label>
          {error && (
            <p className="error-banner wide" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={creating}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary-button" disabled={creating || !valid}>
            {creating && <LoaderCircle size={15} className="spin" />}
            {creating ? t('create.creating') : t('create.submit')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
