import { ArrowLeft, CheckCircle2, LoaderCircle, Plug, Server, X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ProfileSchema, type Profile, type SshConfigEntry } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { Modal } from './ui/Modal'

interface Props {
  profile?: Profile
  onClose: () => void
  onSave: (profile: Profile) => Promise<void>
  onCancelNavigation?: () => void
  embedded?: boolean
  navigationRef?: RefObject<(() => void) | null>
}

export function ProfileEditor({
  profile,
  onClose,
  onSave,
  embedded,
  navigationRef,
  onCancelNavigation
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Profile>(() =>
    profile
      ? { ...profile }
      : {
          id: crypto.randomUUID(),
          label: '',
          host: '',
          port: 22,
          authMode: 'key',
          defaultCwd: '~',
          defaultSession: 'claude-main',
          claudePath: 'cc'
        }
  )
  const form = useRef<HTMLFormElement>(null)
  const [initialMode] = useState<'alias' | 'manual'>(
    profile && !profile.sshHost ? 'manual' : 'alias'
  )
  const [initialDraft] = useState(() => JSON.stringify(draft))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const requestClose = (): void => {
    if (confirmDiscard) {
      setConfirmDiscard(false)
      onCancelNavigation?.()
      return
    }
    if (JSON.stringify(draft) !== initialDraft || mode !== initialMode) setConfirmDiscard(true)
    else onClose()
  }
  const [mode, setMode] = useState<'alias' | 'manual'>(initialMode)
  const [entries, setEntries] = useState<SshConfigEntry[]>([])
  const [busy, setBusy] = useState<'save' | 'test'>()
  useEffect(() => {
    if (navigationRef)
      navigationRef.current = () => {
        if (!busy) requestClose()
      }
    return () => {
      if (navigationRef) navigationRef.current = null
    }
  })
  const [error, setError] = useState('')
  const [tested, setTested] = useState(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error || tested) feedback.current?.scrollIntoView({ block: 'nearest' })
  }, [error, tested])
  useEffect(() => {
    let active = true
    void window.claudeBridge.profiles
      .getSshConfig()
      .then((config) => {
        if (active) setEntries(config.entries)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])
  const update = (patch: Partial<Profile>): void => {
    setDraft((previous) => ({ ...previous, ...patch }))
    setTested(false)
    setError('')
  }
  const parsed = ProfileSchema.safeParse({
    ...draft,
    label: draft.label.trim(),
    defaultCwd: draft.defaultCwd.trim(),
    defaultSession: draft.defaultSession.trim(),
    claudePath: draft.claudePath.trim(),
    sshHost: mode === 'alias' ? draft.sshHost?.trim() : undefined,
    host: mode === 'alias' ? draft.sshHost?.trim() : draft.host.trim()
  })
  const valid = parsed.success && (mode !== 'alias' || !!draft.sshHost?.trim())
  const perform = async (action: 'save' | 'test'): Promise<void> => {
    if (busy || !form.current?.reportValidity()) return
    if (!parsed.success || !valid) {
      const field = !parsed.success ? String(parsed.error.issues[0]?.path[0] ?? 'host') : 'sshHost'
      const fieldLabels: Record<string, string> = {
        label: 'library.name',
        host: 'settings.host',
        sshHost: 'settings.sshHost',
        port: 'settings.port',
        user: 'settings.user',
        defaultCwd: 'create.cwd',
        defaultSession: 'settings.defaultSession',
        claudePath: 'settings.claudePath',
        privateKeyPath: 'settings.keyPath',
        proxyJump: 'settings.proxyJump'
      }
      setError(t('settings.invalid', { field: t(fieldLabels[field] ?? 'settings.host') }))
      return
    }
    setBusy(action)
    setError('')
    setTested(false)
    try {
      if (action === 'save') {
        await onSave(parsed.data)
        onClose()
      } else {
        const result = await window.claudeBridge.profiles.test(parsed.data)
        if (!result.ok) throw new Error(result.message)
        setTested(true)
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': /, '')
          : String(reason)
      )
    } finally {
      setBusy(undefined)
    }
  }
  if (confirmDiscard)
    return (
      <DiscardChangesDialog
        embedded={embedded}
        onContinue={() => {
          setConfirmDiscard(false)
          onCancelNavigation?.()
        }}
        onDiscard={onClose}
      />
    )
  return (
    <Modal
      embedded={embedded}
      className="profile-editor"
      label={t(profile ? 'library.edit' : 'library.add')}
      onClose={requestClose}
      dismissible={!busy}
    >
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault()
          void perform('save')
        }}
      >
        <header className="modal-header">
          <div className="profile-editor-title">
            <span className="server-card-icon">
              <Server size={20} />
            </span>
            <div>
              <h2>{t(profile ? 'library.edit' : 'library.add')}</h2>
              <p>{t('library.editorHint')}</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t(embedded ? 'common.back' : 'common.close')}
            onClick={requestClose}
            disabled={!!busy}
          >
            {embedded ? <ArrowLeft size={18} /> : <X size={18} />}
          </button>
        </header>
        <div className="profile-editor-scroll">
          <fieldset className="profile-editor-fields" disabled={!!busy}>
            <label>
              {t('library.name')}
              <input
                autoFocus
                value={draft.label}
                maxLength={80}
                placeholder={t('library.namePlaceholder')}
                onChange={(event) => update({ label: event.target.value })}
                required
              />
            </label>
            <div className="connection-mode" role="group" aria-label={t('library.connectionMode')}>
              <button
                type="button"
                aria-pressed={mode === 'alias'}
                onClick={() => {
                  setMode('alias')
                  setTested(false)
                  setError('')
                }}
              >
                {t('library.sshConfig')}
              </button>
              <button
                type="button"
                aria-pressed={mode === 'manual'}
                onClick={() => {
                  setMode('manual')
                  setTested(false)
                  setError('')
                }}
              >
                {t('library.manual')}
              </button>
            </div>
            {mode === 'alias' ? (
              <label>
                {t('settings.sshHost')}
                <input
                  list="server-ssh-aliases"
                  value={draft.sshHost ?? ''}
                  placeholder="exp"
                  onChange={(event) => update({ sshHost: event.target.value })}
                  required
                />
                <datalist id="server-ssh-aliases">
                  {entries.map((entry, index) => (
                    <option key={`${entry.host}-${index}`} value={entry.host} />
                  ))}
                </datalist>
                <small>{t('library.aliasHint')}</small>
              </label>
            ) : (
              <div className="form-grid">
                <label>
                  {t('settings.host')}
                  <input
                    required
                    value={draft.host}
                    placeholder="192.168.1.10"
                    onChange={(event) => update({ host: event.target.value })}
                  />
                </label>
                <label>
                  {t('settings.port')}
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={draft.port}
                    onChange={(event) => update({ port: Number(event.target.value) })}
                  />
                </label>
                <label>
                  {t('settings.user')}
                  <input
                    value={draft.user ?? ''}
                    placeholder="ubuntu"
                    onChange={(event) => update({ user: event.target.value || undefined })}
                  />
                </label>
                <label>
                  {t('settings.auth')}
                  <select
                    value={draft.authMode}
                    onChange={(event) =>
                      update({ authMode: event.target.value as Profile['authMode'] })
                    }
                  >
                    <option value="key">{t('settings.authKey')}</option>
                    <option value="agent">{t('settings.authAgent')}</option>
                    <option value="password">{t('settings.authPassword')}</option>
                  </select>
                </label>
                {draft.authMode === 'key' && (
                  <label className="wide">
                    {t('settings.keyPath')}
                    <input
                      value={draft.privateKeyPath ?? ''}
                      placeholder={t('settings.keyPlaceholder')}
                      onChange={(event) =>
                        update({ privateKeyPath: event.target.value || undefined })
                      }
                    />
                  </label>
                )}
                <label className="wide">
                  {t('settings.proxyJump')}
                  <input
                    value={draft.proxyJump ?? ''}
                    placeholder="user@bastion:22"
                    onChange={(event) => update({ proxyJump: event.target.value || undefined })}
                  />
                </label>
              </div>
            )}
            <div className="profile-defaults-heading">{t('library.sessionDefaults')}</div>
            <div className="form-grid">
              <label>
                {t('create.cwd')}
                <input
                  required
                  value={draft.defaultCwd}
                  onChange={(event) => update({ defaultCwd: event.target.value })}
                />
              </label>
              <label>
                {t('settings.claudePath')}
                <input
                  required
                  value={draft.claudePath}
                  onChange={(event) => update({ claudePath: event.target.value })}
                />
              </label>
              <label className="wide">
                {t('settings.defaultSession')}
                <input
                  required
                  value={draft.defaultSession}
                  onChange={(event) => update({ defaultSession: event.target.value })}
                  pattern="[A-Za-z0-9_.-]{1,64}"
                />
              </label>
            </div>
            {error && (
              <p ref={feedback} className="error-banner" role="alert">
                {error}
              </p>
            )}
            {tested && (
              <p ref={feedback} className="profile-test-ok" role="status">
                <CheckCircle2 size={16} />
                {t('settings.testSucceeded')}
              </p>
            )}
          </fieldset>
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="secondary-button profile-test-button"
            disabled={!!busy}
            onClick={() => void perform('test')}
          >
            {busy === 'test' ? <LoaderCircle size={15} className="spin" /> : <Plug size={15} />}
            {t('settings.test')}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={requestClose}
            disabled={!!busy}
          >
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary-button" disabled={!!busy}>
            {busy === 'save' ? <LoaderCircle size={15} className="spin" /> : null}
            {t('library.save')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
