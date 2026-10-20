import { Copy, Folder, FolderOpen, MessageSquare, Pin } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import type { Profile, SessionTarget } from '../../../shared/contracts'
import type { groupSessionDirectories } from '../workspace-navigation'
import { useI18n } from '../i18n'
import { useLayoutPreferences } from '../layout-preferences'
import { targetKey, useAppStore } from '../store'
import { useWorkspacePreferences } from '../workspace-preferences'
import { sessionActivity } from '../session-presentation'
import { SessionStatusIcon } from './SessionStatusIcon'
import { SessionRowActions } from './SessionRowActions'
import { SidebarRowMenu } from './SidebarRowMenu'
import { orderedItems, orderScope, useSidebarOrder, type SidebarDragProps } from '../sidebar-order'
import { connectionIdentity } from '../../../shared/profile-identity'

interface Props {
  dragProps: SidebarDragProps
  folderScope: string
  folderIds: string[]
  sessionIds: string[]
  profile: Profile
  group: ReturnType<typeof groupSessionDirectories>[number]
  revealed: boolean
  verified: boolean
  workspace: boolean
  onOpen: (target: SessionTarget) => void
  onTerminate: (target: SessionTarget) => void
  onLoad: () => void
  onNavigate: (event: KeyboardEvent<HTMLButtonElement>) => void
}
export function SessionProjectGroup({
  dragProps,
  folderScope,
  folderIds,
  sessionIds,
  profile,
  group,
  revealed,
  verified,
  workspace,
  onOpen,
  onTerminate,
  onLoad,
  onNavigate
}: Props): React.JSX.Element {
  const { t } = useI18n()
  const orders = useSidebarOrder((s) => s.orders)
  const sessionScope = orderScope('sessions', connectionIdentity(profile), group.path)
  const orderedSessions = orderedItems(
    group.sessions,
    orders[sessionScope],
    (session) => session.name
  )
  const orderedSessionIds = orderedItems(sessionIds, orders[sessionScope], (id) => id)
  const folded = useLayoutPreferences((s) => s.folded[group.foldKey] ?? false)
  const selected = useAppStore((s) => s.selected)
  const statuses = useAppStore((s) => s.statuses)
  const timelines = useAppStore((s) => s.timelines)
  const saved = useWorkspacePreferences((s) => s.projects[profile.id]?.sessions)
  const expanded = revealed || !folded
  const expand = (value: boolean): void => {
    const layout = useLayoutPreferences.getState()
    layout.update({ folded: { ...layout.folded, [group.foldKey]: !value } })
  }
  return (
    <div className="session-project-group" data-directory={group.path}>
      <SidebarRowMenu
        className="project-heading-wrap"
        label={`${t('sidebar.folderActions')} · ${group.label}`}
        items={[
          {
            label: t(expanded ? 'sidebar.collapseFolder' : 'sidebar.expandFolder'),
            icon: expanded ? <Folder size={14} /> : <FolderOpen size={14} />,
            run: () => expand(!expanded)
          },
          {
            label: t('sidebar.copyPath'),
            icon: <Copy size={14} />,
            run: () => {
              void navigator.clipboard.writeText(group.path).then(
                () =>
                  useAppStore
                    .getState()
                    .showToast({ level: 'info', title: t('work.copied'), body: '' }),
                () =>
                  useAppStore
                    .getState()
                    .showToast({ level: 'error', title: t('render.copyFailed'), body: '' })
              )
            }
          }
        ]}
      >
        <button
          {...dragProps(
            folderScope,
            group.path,
            orderedItems(folderIds, orders[folderScope], (id) => id)
          )}
          className="project-heading"
          aria-label={group.label}
          aria-expanded={expanded}
          aria-controls={group.domId}
          title={group.path}
          onClick={() => expand(!expanded)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            expand(event.key === 'ArrowRight')
          }}
        >
          {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span>{group.label}</span>
        </button>
      </SidebarRowMenu>
      <div
        className="project-sessions"
        id={group.domId}
        data-expanded={expanded}
        inert={!expanded}
        aria-hidden={!expanded}
      >
        <div className="project-sessions-inner">
          <div className="session-list">
            {orderedSessions.map((session) => {
              const target = { profileId: profile.id, sessionName: session.name }
              const key = targetKey(target)
              const isSelected = workspace && selected && targetKey(selected) === key
              const title = saved?.[session.name]?.title || session.name
              const activity =
                !verified && !statuses[key]
                  ? 'work.saved'
                  : sessionActivity(statuses[key], timelines[key])
              const label = t(activity)
              return (
                <SessionRowActions
                  key={key}
                  profile={profile}
                  name={session.name}
                  onTerminate={onTerminate}
                >
                  <button
                    {...dragProps(sessionScope, session.name, orderedSessionIds)}
                    className={`session-row session-entry ${isSelected ? 'selected' : ''}`}
                    onClick={() => onOpen(target)}
                    onKeyDown={onNavigate}
                    aria-current={isSelected ? 'page' : undefined}
                    aria-label={`${title} · ${label}`}
                    title={`${title} · ${label}\n${profile.sshHost ?? profile.host} · ${group.path}\n${session.name}`}
                  >
                    {saved?.[session.name]?.pinned ? (
                      <Pin className="session-kind-icon" size={13} aria-label={t('work.pinned')} />
                    ) : (
                      <MessageSquare className="session-kind-icon" size={13} aria-hidden="true" />
                    )}
                    <span className="session-copy">
                      <strong>{title}</strong>
                    </span>
                    <SessionStatusIcon activity={activity} label={label} />
                  </button>
                </SessionRowActions>
              )
            })}
          </div>
          {!group.sessions.length && (
            <button className="project-empty" onClick={onLoad}>
              {t(verified ? 'work.noSessions' : 'work.load')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
