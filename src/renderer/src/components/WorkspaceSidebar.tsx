import {
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Stethoscope,
  Trash2,
  X
} from 'lucide-react'
import {
  useMemo,
  useRef,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { Profile, RemoteSession, SessionTarget } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { targetKey, useAppStore } from '../store'
import { projectName, useWorkspacePreferences } from '../workspace-preferences'
import { SidebarSizer } from './SidebarSizer'
import { SessionProjectGroup } from './SessionProjectGroup'
import {
  groupSessionDirectories,
  matchesActivity,
  needsAttention,
  type ActivityFilter
} from '../workspace-navigation'
import { useLayoutPreferences } from '../layout-preferences'
import { connectionIdentity } from '../../../shared/profile-identity'
import { SidebarRowMenu } from './SidebarRowMenu'
import { DeleteServerDialog } from './DeleteServerDialog'
import { SidebarRail } from './SidebarRail'
import { BrandLogo } from './BrandLogo'
import { orderedItems, orderScope, useSidebarOrder, useSidebarReorder } from '../sidebar-order'

interface Props {
  profiles: Profile[]
  currentProfileId: string
  page: 'servers' | 'workspace'
  loading: boolean
  onOpen: (target: SessionTarget) => void
  onLoadProfile: (id: string) => void
  onNew: (profileId?: string) => void
  onManage: () => void
  onRefresh: () => void
  onSettings: () => void
  onDiagnostics: () => void
  onEditProfile: (profile: Profile) => void
  onDeleteProfile: (id: string) => Promise<void>
  onTerminate: (target: SessionTarget) => void
}

export function WorkspaceSidebar(props: Props): React.JSX.Element {
  const { t, language } = useI18n()
  const foldedServers = useLayoutPreferences((s) => s.foldedServers)
  const updateLayout = useLayoutPreferences((s) => s.update)
  const orders = useSidebarOrder((s) => s.orders)
  const dragProps = useSidebarReorder()
  const appearance = useAppStore((s) => s.settings!.appearance)
  const catalog = useAppStore((s) => s.sessionsByProfile)
  const statuses = useAppStore((s) => s.statuses)
  const selected = useAppStore((s) => s.selected)
  const preferences = useWorkspacePreferences((s) => s.projects)
  const collapsed = useWorkspacePreferences((s) => s.collapsed)
  const setCollapsed = useWorkspacePreferences((s) => s.setCollapsed)
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Profile>()
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const search = useRef<HTMLInputElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const sessionButtons = (): HTMLButtonElement[] =>
    [...(navigation.current?.querySelectorAll<HTMLButtonElement>('.session-entry') ?? [])].filter(
      (element) => !element.closest('[inert]') && element.getClientRects().length > 0
    )
  const openSession = (target: SessionTarget): void => {
    setQuery('')
    setActivityFilter('all')
    props.onOpen(target)
  }
  const navigateSession = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Escape') {
      setQuery('')
      setActivityFilter('all')
      search.current?.focus()
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = sessionButtons()
    const index = buttons.indexOf(event.currentTarget)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
    event.preventDefault()
    buttons[next]?.focus()
  }
  const activeStatuses = Object.values(statuses).filter((status) =>
    props.profiles.some((profile) => profile.id === status.profileId)
  )
  const runningCount = activeStatuses.filter((status) => matchesActivity(status, 'running')).length
  const attentionCount = activeStatuses.filter(needsAttention).length
  useEffect(() => {
    const find = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('[aria-modal="true"]')
      )
        return
      // A directly controlled terminal owns its keyboard shortcuts.
      if (
        event.target instanceof Element &&
        event.target.closest('.xterm') &&
        useAppStore.getState().directControl
      )
        return
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        setCollapsed(false)
        setActivityFilter('all')
        requestAnimationFrame(() => search.current?.focus())
      }
    }
    window.addEventListener('keydown', find)
    return () => window.removeEventListener('keydown', find)
  }, [setCollapsed])

  const groups = useMemo(
    () =>
      orderedItems(props.profiles, orders.servers, (profile) => profile.id).map((profile) => {
        const saved = preferences[profile.id]?.sessions ?? {}
        const known = catalog[profile.id]
        const sessions: RemoteSession[] =
          known ??
          Object.keys(saved).map((name) => ({
            name,
            windows: 0,
            attachedClients: 0,
            currentPath: saved[name]?.cwd ?? profile.defaultCwd
          }))
        const allSessions = [...sessions].sort(
          (a, b) =>
            Number(!!saved[b.name]?.pinned) - Number(!!saved[a.name]?.pinned) ||
            (saved[b.name]?.lastOpened ?? 0) - (saved[a.name]?.lastOpened ?? 0) ||
            a.name.localeCompare(b.name)
        )
        const filtered = allSessions.filter(
          (session) =>
            matchesActivity(
              statuses[targetKey({ profileId: profile.id, sessionName: session.name })],
              activityFilter
            ) &&
            `${profile.label} ${profile.sshHost ?? profile.host} ${session.currentPath ?? profile.defaultCwd} ${session.name} ${saved[session.name]?.title ?? ''}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())
        )
        const matchesProfile =
          activityFilter === 'all' &&
          `${profile.label} ${profile.sshHost ?? profile.host} ${profile.defaultCwd}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase())
        return {
          profile,
          sessions: filtered,
          allSessions,
          verified: !!known,
          saved,
          matchesProfile
        }
      }),
    [props.profiles, catalog, preferences, query, activityFilter, statuses, orders]
  )

  return (
    <aside
      className="sidebar task-sidebar"
      id="workspace-sidebar"
      aria-label={t('sidebar.label')}
      data-collapsed={collapsed}
    >
      {!collapsed && <SidebarSizer />}
      {collapsed && (
        <SidebarRail
          target={props.page === 'workspace' ? selected : undefined}
          hasProfiles={props.profiles.length > 0}
          onExpandSidebar={() => {
            setCollapsed(false)
            requestAnimationFrame(() =>
              document.querySelector<HTMLButtonElement>('.app-titlebar .sidebar-close')?.focus()
            )
          }}
          onNew={props.onNew}
          onManage={props.onManage}
          onSettings={props.onSettings}
          onDiagnostics={props.onDiagnostics}
          onSearch={() => {
            setCollapsed(false)
            setActivityFilter('all')
            requestAnimationFrame(() => search.current?.focus())
          }}
        />
      )}
      <div className="sidebar-expanded-content" hidden={collapsed} inert={collapsed}>
        <div className="brand">
          <BrandLogo />
          <strong>Conlaude</strong>
        </div>
        <div className="sidebar-content" id="sidebar-content">
          <button className="new-session-button" onClick={() => props.onNew()}>
            <Plus size={18} />
            {t('work.new')}
          </button>
          <label className="sidebar-search" title={t('work.searchHint')}>
            <Search size={17} />
            <input
              ref={search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('work.search')}
              aria-label={t('work.search')}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Escape') {
                  setQuery('')
                  setActivityFilter('all')
                  e.currentTarget.blur()
                }
                if (e.key === 'Enter' && query.trim()) {
                  e.preventDefault()
                  sessionButtons()[0]?.click()
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  const buttons = sessionButtons()
                  buttons[e.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus()
                }
              }}
            />
            <kbd>Ctrl K</kbd>
          </label>
          {query.trim() && (
            <div className="sidebar-search-help" role="status">
              <span>
                {groups.reduce((count, group) => count + group.sessions.length, 0)}{' '}
                {language === 'zh-CN' ? '个会话' : 'chats'}
              </span>
              <span>{language === 'zh-CN' ? '↓ 选择 · Enter 打开' : '↓ Select · Enter Open'}</span>
            </div>
          )}
          {(runningCount > 0 || attentionCount > 0 || activityFilter !== 'all') && (
            <div
              className="workspace-activity-filters"
              aria-label={language === 'zh-CN' ? '会话活动筛选' : 'Filter chat activity'}
            >
              {(runningCount > 0 || activityFilter === 'running') && (
                <button
                  aria-pressed={activityFilter === 'running'}
                  onClick={() =>
                    setActivityFilter(activityFilter === 'running' ? 'all' : 'running')
                  }
                >
                  <LoaderCircle size={12} />
                  {language === 'zh-CN' ? '运行中' : 'Running'} <b>{runningCount}</b>
                </button>
              )}
              {(attentionCount > 0 || activityFilter === 'attention') && (
                <button
                  data-attention="true"
                  aria-pressed={activityFilter === 'attention'}
                  onClick={() =>
                    setActivityFilter(activityFilter === 'attention' ? 'all' : 'attention')
                  }
                >
                  <CircleAlert size={12} />
                  {language === 'zh-CN' ? '待处理' : 'Attention'} <b>{attentionCount}</b>
                </button>
              )}
              {activityFilter !== 'all' && (
                <button
                  className="activity-filter-clear"
                  onClick={() => setActivityFilter('all')}
                  aria-label={language === 'zh-CN' ? '显示全部会话' : 'Show all chats'}
                  title={language === 'zh-CN' ? '显示全部会话' : 'Show all chats'}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <div className="sidebar-section-title">
            <span>{language === 'zh-CN' ? '服务器' : 'Servers'}</span>
            <button
              className="icon-button"
              onClick={props.onRefresh}
              aria-label={t('sidebar.refresh')}
              title={t('sidebar.refresh')}
              disabled={props.loading}
            >
              <RefreshCw size={14} className={props.loading ? 'spin' : ''} />
            </button>
          </div>
          <nav ref={navigation} className="project-list" aria-label={t('work.projects')}>
            {groups.map(({ profile, sessions, allSessions, verified, matchesProfile }) => {
              const identity = connectionIdentity(profile)
              const folderScope = orderScope('folders', identity)
              const allDirectories = groupSessionDirectories(profile, allSessions)
              const directories = orderedItems(
                groupSessionDirectories(profile, sessions),
                orders[folderScope],
                (group) => group.path
              )
              const serverExpanded =
                !!query ||
                activityFilter !== 'all' ||
                !(
                  foldedServers[identity] ??
                  !(props.page === 'workspace' && props.currentProfileId === profile.id)
                )
              const expandServer = (expanded: boolean): void => {
                updateLayout({ foldedServers: { ...foldedServers, [identity]: !expanded } })
                if (expanded && !verified) props.onLoadProfile(profile.id)
              }
              return (
                <section
                  className="project-group"
                  key={profile.id}
                  hidden={
                    (!!query || activityFilter !== 'all') && !sessions.length && !matchesProfile
                  }
                >
                  <SidebarRowMenu
                    className="sidebar-server-wrap"
                    actions={
                      <button
                        type="button"
                        className="icon-button server-new-session"
                        aria-label={t('create.onServer', { server: profile.label })}
                        title={t('create.onServer', { server: profile.label })}
                        onClick={() => props.onNew(profile.id)}
                      >
                        <Plus size={15} />
                      </button>
                    }
                    label={`${t('sidebar.serverActions')} · ${profile.label}`}
                    items={[
                      {
                        label: t(
                          serverExpanded ? 'sidebar.collapseServer' : 'sidebar.expandServer'
                        ),
                        icon: <Server size={14} />,
                        run: () => expandServer(!serverExpanded)
                      },
                      {
                        label: t('library.edit'),
                        icon: <Pencil size={14} />,
                        run: () => props.onEditProfile(profile)
                      },
                      {
                        label: t('library.delete'),
                        icon: <Trash2 size={14} />,
                        danger: true,
                        separator: true,
                        run: () => setDeleteTarget(profile)
                      }
                    ]}
                  >
                    <button
                      {...dragProps(
                        'servers',
                        profile.id,
                        groups.map((group) => group.profile.id)
                      )}
                      className={`sidebar-server ${props.currentProfileId === profile.id && props.page === 'workspace' ? 'current' : ''}`}
                      onClick={() => expandServer(!serverExpanded)}
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                        event.preventDefault()
                        expandServer(event.key === 'ArrowRight')
                      }}
                      aria-label={`${projectName(profile)} · ${profile.sshHost ?? profile.host}`}
                      aria-expanded={serverExpanded}
                      aria-controls={`server-projects-${profile.id}`}
                      title={`${profile.label} · ${profile.sshHost ?? profile.host}\n${language === 'zh-CN' ? (serverExpanded ? '收起服务器' : '展开服务器') : serverExpanded ? 'Collapse server' : 'Expand server'}`}
                    >
                      <span className="sidebar-server-icon" aria-hidden="true">
                        <Server size={17} />
                        <ChevronRight className="server-fold-indicator" size={10} />
                      </span>
                      <span className="sidebar-server-copy">
                        <strong>{profile.label}</strong>
                        {appearance.showServerAddress && (
                          <small>{profile.sshHost ?? profile.host}</small>
                        )}
                      </span>
                      {appearance.showSessionCount && (
                        <span
                          className="sidebar-server-count"
                          title={language === 'zh-CN' ? '会话数量' : 'Sessions'}
                        >
                          {verified ? sessions.length : '—'}
                        </span>
                      )}
                    </button>
                  </SidebarRowMenu>
                  <div
                    className="server-projects"
                    id={`server-projects-${profile.id}`}
                    data-expanded={serverExpanded}
                    inert={!serverExpanded}
                    aria-hidden={!serverExpanded}
                  >
                    <div className="server-projects-inner">
                      {directories.map((group) => (
                        <SessionProjectGroup
                          key={group.path}
                          profile={profile}
                          group={group}
                          dragProps={dragProps}
                          folderScope={folderScope}
                          folderIds={allDirectories.map((directory) => directory.path)}
                          sessionIds={allDirectories
                            .find((directory) => directory.path === group.path)!
                            .sessions.map((session) => session.name)}
                          revealed={!!query || activityFilter !== 'all'}
                          verified={verified}
                          workspace={props.page === 'workspace'}
                          onOpen={openSession}
                          onTerminate={props.onTerminate}
                          onLoad={() => props.onLoadProfile(profile.id)}
                          onNavigate={navigateSession}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )
            })}
            {(query || activityFilter !== 'all') &&
              groups.every((group) => !group.sessions.length && !group.matchesProfile) && (
                <p className="sidebar-empty">{t('profiles.noResults')}</p>
              )}
          </nav>
          <div className="sidebar-bottom">
            <button
              className={`sidebar-footer-button ${props.page === 'servers' ? 'active' : ''}`}
              onClick={props.onManage}
            >
              <Server size={17} />
              {t('work.manage')}
            </button>
            <button
              className="sidebar-footer-button"
              onClick={props.onDiagnostics}
              disabled={!props.profiles.length}
            >
              <Stethoscope size={17} />
              {t('sidebar.diagnostics')}
            </button>
            <button className="sidebar-footer-button" onClick={props.onSettings}>
              <Settings size={17} />
              {t('sidebar.settings')}
            </button>
          </div>
        </div>
      </div>
      {deleteTarget && (
        <DeleteServerDialog
          profile={deleteTarget}
          onDelete={props.onDeleteProfile}
          onClose={() => setDeleteTarget(undefined)}
        />
      )}
    </aside>
  )
}
