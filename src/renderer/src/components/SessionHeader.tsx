import {
  ArrowLeftRight,
  Eye,
  LogOut,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  Server,
  Trash2,
  Unplug
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  Profile,
  RemoteSession,
  SessionStatus,
  SessionTarget
} from '../../../shared/contracts'
import { sessionCommands, onWorkspaceCommand } from '../app-commands'
import { useI18n } from '../i18n'
import { targetKey, useAppStore } from '../store'
import { sessionActivity } from '../session-presentation'
import { useWorkspacePreferences } from '../workspace-preferences'
import { useEscapeKey } from '../use-escape-key'
import { EditTitleDialog } from './EditTitleDialog'
import { SessionStatusIcon } from './SessionStatusIcon'

interface Props {
  readingWidthLabel: string
  onToggleReadingWidth: () => void
  profile: Profile
  target?: SessionTarget
  session?: RemoteSession
  status?: SessionStatus
  onDisconnect: () => void
  onReconnect: () => void
  onObserve: () => void
  onTakeover: () => void
  onTerminate: () => void
  onRenameRemote: () => void
}

export function SessionHeader({
  profile,
  readingWidthLabel,
  onToggleReadingWidth,
  target,
  session,
  status,
  ...actions
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const available = sessionCommands(session, status)
  const appearance = useAppStore((s) => s.settings!.appearance)
  const events = useAppStore((s) => (target ? s.timelines[targetKey(target)] : undefined))
  const activity = sessionActivity(status, events)
  const projects = useWorkspacePreferences((s) => s.projects)
  const update = useWorkspacePreferences((s) => s.updateSession)
  const preference = target ? projects[target.profileId]?.sessions[target.sessionName] : undefined
  const title = preference?.title || target?.sessionName || t('work.start')
  const menu = useRef<HTMLDetailsElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const closeMenu = (): void => {
    if (menu.current) menu.current.open = false
    setMenuOpen(false)
  }
  useEscapeKey(closeMenu, menuOpen && !editing)
  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (e: PointerEvent): void => {
      if (!menu.current?.contains(e.target as Node)) {
        if (menu.current) menu.current.open = false
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [menuOpen])

  useEffect(
    () =>
      onWorkspaceCommand((command) => {
        if (command === 'edit-title' && target) {
          setEditing(true)
        }
      }),
    [target]
  )

  return (
    <>
      <header className="workspace-header" data-view-labels={appearance.showViewLabels}>
        <div className="workspace-title">
          {appearance.headerServer !== 'hidden' && (
            <span
              className="workspace-endpoint"
              title={`${profile.label} · ${profile.sshHost ?? profile.host}`}
            >
              <Server size={13} />
              <span>
                {appearance.headerServer === 'label'
                  ? profile.label
                  : (profile.sshHost ?? profile.host)}
              </span>
            </span>
          )}
          <h1
            title={
              target && title !== target.sessionName
                ? `${title}\n${t('work.originalTitle')}: ${target.sessionName}`
                : title
            }
          >
            {title}
          </h1>
          {target && (
            <span className="workspace-tmux" title={`tmux: ${target.sessionName}`}>
              tmux: {target.sessionName}
            </span>
          )}
        </div>
        <div className="header-actions">
          <button
            className="icon-button reading-width-toggle"
            onClick={onToggleReadingWidth}
            title={readingWidthLabel}
            aria-label={readingWidthLabel}
          >
            <ArrowLeftRight size={16} />
          </button>
          <details
            ref={menu}
            className="session-menu"
            onToggle={(e) => setMenuOpen(e.currentTarget.open)}
          >
            <summary aria-label={t('work.actions')} title={t('work.actions')}>
              <MoreHorizontal size={20} />
            </summary>
            <div className="session-menu-content">
              <div className="session-menu-context">
                <strong>{t('work.details')}</strong>
                <dl>
                  <div>
                    <dt>{t('work.infoServer')}</dt>
                    <dd>{profile.label}</dd>
                  </div>
                  <div>
                    <dt title={profile.sshHost ? t('work.infoSshHint') : undefined}>
                      {t(profile.sshHost ? 'work.infoSshAlias' : 'work.infoAddress')}
                    </dt>
                    <dd>
                      <code>
                        {profile.sshHost ||
                          `${profile.user ? `${profile.user}@` : ''}${profile.host.includes(':') ? `[${profile.host}]` : profile.host}:${profile.port}`}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {t(session?.currentPath ? 'work.infoDirectory' : 'work.infoDefaultDirectory')}
                    </dt>
                    <dd>
                      <code>{session?.currentPath ?? profile.defaultCwd}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('work.infoSession')}</dt>
                    <dd>
                      <code>{target?.sessionName ?? '—'}</code>
                    </dd>
                  </div>
                  {session && (
                    <div>
                      <dt>{t('work.infoClients')}</dt>
                      <dd>{t('work.clients', { count: session.attachedClients })}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <button
                disabled={!target}
                onClick={() => {
                  closeMenu()
                  menu.current?.querySelector('summary')?.focus()
                  setEditing(true)
                }}
              >
                <Pencil size={15} />
                {t('work.editTitle')}
              </button>
              <button
                disabled={!target}
                onClick={() => {
                  if (target) update(profile, target.sessionName, { pinned: !preference?.pinned })
                  closeMenu()
                }}
              >
                <Pin size={15} />
                {t(preference?.pinned ? 'work.unpin' : 'work.pin')}
              </button>
              <hr />
              <button
                disabled={!target}
                onClick={() => {
                  actions.onReconnect()
                  closeMenu()
                }}
              >
                <RefreshCw size={15} />
                {t('work.reconnect')}
              </button>
              <button
                disabled={!available.observe}
                onClick={() => {
                  actions.onObserve()
                  closeMenu()
                }}
              >
                <Eye size={15} />
                {t('work.observe')}
              </button>
              <button
                disabled={!available.takeover}
                onClick={() => {
                  actions.onTakeover()
                  closeMenu()
                }}
              >
                <Unplug size={15} />
                {t('sidebar.takeover')}
              </button>
              <button
                disabled={!available.disconnect}
                onClick={() => {
                  actions.onDisconnect()
                  closeMenu()
                }}
                title={t('work.disconnectHint')}
              >
                <LogOut size={15} />
                {t('work.disconnect')}
              </button>
              <hr />
              <button
                disabled={!available.rename}
                onClick={() => {
                  actions.onRenameRemote()
                  closeMenu()
                }}
              >
                <Pencil size={15} />
                {t('work.renameRemote')}
              </button>
              <button
                className="menu-danger"
                disabled={!available.terminate}
                onClick={() => {
                  actions.onTerminate()
                  closeMenu()
                }}
              >
                <Trash2 size={15} />
                {t('work.terminate')}
              </button>
            </div>
          </details>
          {appearance.showConnectionStatus && (
            <span className="workspace-context">
              <SessionStatusIcon
                activity={activity}
                label={t(activity)}
                className={`connection-label ${status?.state ?? 'idle'}`}
              />
            </span>
          )}
        </div>
      </header>
      {editing && target && (
        <EditTitleDialog
          sessionName={target.sessionName}
          title={preference?.title}
          onSave={(title) => update(profile, target.sessionName, { title })}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}
