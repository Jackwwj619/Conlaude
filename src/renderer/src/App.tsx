import { ArrowLeft, Moon, Plus, RefreshCw, Sun, X } from 'lucide-react'
import {
  type CSSProperties,
  createRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  MAX_PROFILES,
  type AppSettings,
  type CreateSessionRequest,
  type Profile,
  type RemoteSession,
  type SessionTarget,
  type TimelineEvent
} from '../../shared/contracts'
import { interfaceFontFamily, terminalFontFamily } from '../../shared/font-presets'
import { translate } from '../../shared/i18n'
import { connectionIdentity } from '../../shared/profile-identity'
import { canUpload, sessionCommands, runWorkspaceCommand } from './app-commands'
import { FeedbackText } from './components/FeedbackText'
import { AppTitleBar, type AppMenu } from './components/AppTitleBar'
import { SidebarToggleIcon } from './components/SidebarToggleIcon'
import { BrandLogo } from './components/BrandLogo'
import type { WindowCommand } from '../../shared/window-commands'
import { Composer } from './components/Composer'
import { CreateSessionDialog } from './components/CreateSessionDialog'
import { DiagnosticsDialog } from './components/DiagnosticsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SessionActionDialog } from './components/SessionActionDialog'
import { PanelDock } from './components/PanelDock'
import './panel-docking.css'
import { TerminalPanel } from './components/TerminalPanel'
import { Timeline } from './components/Timeline'
import { ServerLibrary } from './components/ServerLibrary'
import { ProfileEditor } from './components/ProfileEditor'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { WorkspaceNotice } from './components/WorkspaceNotice'
import { SessionHeader } from './components/SessionHeader'
import type { FilePanelActions } from './components/RemoteFilesPanel'
import type { FileDocument } from './components/FileWorkspace'
import { RemoteFileOpenContext, resolveRemoteFileReference, remoteParent } from './file-navigation'
import { Modal } from './components/ui/Modal'
import { useI18n } from './i18n'
import { targetKey, useAppStore } from './store'
import { projectName, useWorkspacePreferences } from './workspace-preferences'

import { useLayoutPreferences } from './layout-preferences'
import './appearance.css'

const EMPTY_EVENTS: TimelineEvent[] = []
const FileWorkspace = lazy(() => import('./components/FileWorkspace'))
function messageFrom(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
    : String(error)
}

export function App(): React.JSX.Element {
  const { t, language } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const sessions = useAppStore((s) => s.sessions)
  const selected = useAppStore((s) => s.selected)
  const workspacePrefs = useWorkspacePreferences((s) => s.projects)
  const composerBusy = useAppStore((s) => s.composerBusy)
  const statuses = useAppStore((s) => s.statuses)
  const events = useAppStore((s) => (s.selected ? s.timelines[targetKey(s.selected)] : undefined))
  const terminalOpen = useAppStore((s) => s.terminalOpen)
  const rightPanel = useAppStore((s) => s.rightPanel)
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)
  const dockWidth = useLayoutPreferences((s) => s.filesWidth)
  const workspaceMode = useAppStore((s) => s.workspaceMode)
  const toast = useAppStore((s) => s.toast)
  const sidebarWidth = useLayoutPreferences((s) => s.sidebarWidth)
  const collapsed = useWorkspacePreferences((s) => s.collapsed)
  const [page, setPage] = useState<'servers' | 'workspace'>(() =>
    useWorkspacePreferences.getState().lastTarget ? 'workspace' : 'servers'
  )
  const [loadingProfiles, setLoadingProfiles] = useState<string[]>([])
  const [listErrors, setListErrors] = useState<Record<string, string>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [fileWorkspaces, setFileWorkspaces] = useState<FileDocument[]>([])
  const [maximizedPanel, setMaximizedPanel] = useState<'right' | 'bottom'>()
  const [activeFileId, setActiveFileId] = useState<number>()
  const [fileOpenRevision, setFileOpenRevision] = useState(0)
  const fileWorkspace = fileWorkspaces.find((item) => item.id === activeFileId)
  const fileRequest = useRef(0)
  const [settingsProfileId, setSettingsProfileId] = useState<string>()
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createProfileId, setCreateProfileId] = useState<string>()
  const [sessionAction, setSessionAction] = useState<{
    action: 'rename' | 'terminate'
    target: SessionTarget
  }>()
  const [takeoverSession, setTakeoverSession] = useState<RemoteSession>()
  const [helperResult, setHelperResult] = useState<{ connection: string; installed: boolean }>()
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [profileEditor, setProfileEditor] = useState<Profile | 'new'>()
  const [bootError, setBootError] = useState('')
  const [composerStatusHost, setComposerStatusHost] = useState<HTMLDivElement | null>(null)
  const loads = useRef(new Map<string, Promise<RemoteSession[] | undefined>>())
  const attaching = useRef(new Set<string>())
  const navigationQueue = useRef<Promise<void>>(Promise.resolve())
  const navigationRequest = useRef(0)
  const notificationNavigate = useRef<(id: string, target: SessionTarget) => Promise<void>>(
    async () => undefined
  )
  const restoreStarted = useRef(false)
  const profile = settings?.profiles.find((p) => p.id === settings.currentProfileId)
  const selectedStatus = selected ? statuses[targetKey(selected)] : undefined
  const connected = selectedStatus?.state === 'attached'
  const selectedSession = sessions.find((s) => s.name === selected?.sessionName)
  const hasSession = !!selected && (!!selectedSession || !!selectedStatus)
  const activeProfileId = profile?.id
  const activeConnection = profile ? connectionIdentity(profile) : ''
  const helperInstalled =
    helperResult?.connection === activeConnection ? helperResult.installed : undefined
  const store = useAppStore.getState
  const openRemoteReference = (
    reference: string,
    source?: { target: SessionTarget; server: string; path: string }
  ): void => {
    const context =
      source ??
      (selected && profile
        ? {
            target: { ...selected },
            server: profile.label,
            path:
              selectedSession?.currentPath ||
              workspacePrefs[selected.profileId]?.sessions[selected.sessionName]?.cwd ||
              profile.defaultCwd ||
              '~'
          }
        : undefined)
    if (!context) return
    const file = resolveRemoteFileReference(reference, context.path)
    if (!file) return
    setFileOpenRevision((revision) => revision + 1)
    store().setRightPanel('files')
    const existing = fileWorkspaces.find(
      (item) => targetKey(item.target) === targetKey(context.target) && item.file === file
    )
    if (existing) setActiveFileId(existing.id)
    else {
      const id = ++fileRequest.current
      setFileWorkspaces((items) => [
        ...items.filter(
          (item) => item.file || targetKey(item.target) !== targetKey(context.target)
        ),
        {
          ...context,
          path: remoteParent(file),
          file,
          id,
          dirty: false,
          actions: createRef<FilePanelActions>()
        }
      ])
      setActiveFileId(id)
    }
    setPage('workspace')
  }
  const selectFiles = (): void => {
    store().setRightPanel('files')
    if (!fileWorkspace && selected && profile) {
      const id = ++fileRequest.current
      setFileWorkspaces((items) => [
        ...items,
        {
          id,
          target: { ...selected },
          server: profile.label,
          path: selectedSession?.currentPath || profile.defaultCwd || '~',
          dirty: false,
          actions: createRef<FilePanelActions>()
        }
      ])
      setActiveFileId(id)
    }
  }
  const closeFile = (id: number): void => {
    const index = fileWorkspaces.findIndex((item) => item.id === id)
    const closing = fileWorkspaces[index]
    if (!closing) return
    const remaining = fileWorkspaces.filter((item) => item.id !== id)
    if (!remaining.length) {
      // Keep the browser and its location when the last document is closed.
      setFileWorkspaces([
        { ...closing, file: undefined, dirty: false, actions: createRef<FilePanelActions>() }
      ])
      return
    }
    setFileWorkspaces(remaining)
    setActiveFileId((active) =>
      active === id ? remaining[Math.min(index, remaining.length - 1)]?.id : active
    )
  }
  const bottomOpen = terminalOpen && workspaceMode === 'terminal'
  const rightTerminal =
    rightPanelOpen &&
    terminalOpen &&
    workspaceMode === 'split' &&
    (rightPanel === 'terminal' || !fileWorkspace)
  const rightFiles = rightPanelOpen && !!fileWorkspace && !rightTerminal
  const rightOpen = rightTerminal || rightFiles
  useEffect(
    () =>
      useAppStore.subscribe((state, previous) => {
        if (
          (previous.rightPanelOpen && !state.rightPanelOpen) ||
          (previous.terminalOpen && !state.terminalOpen) ||
          state.workspaceMode !== previous.workspaceMode
        )
          setMaximizedPanel(undefined)
      }),
    []
  )
  const toggleRight = (): void => {
    if (rightOpen) store().setRightPanelOpen(false)
    else if (rightPanel === 'terminal' && !bottomOpen && hasSession)
      store().setWorkspaceMode('split')
    else selectFiles()
  }
  const openCreate = (profileId?: string): void => {
    if (!settings?.profiles.length) {
      setProfileEditor('new')
      return
    }
    setCreateProfileId(profileId ?? profile?.id ?? settings.profiles[0]!.id)
    setCreateOpen(true)
  }

  useEffect(() => {
    if (!settings) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
      document.documentElement.dataset.interfaceFont = settings.interfaceFont
      document.documentElement.dataset.replyFont = settings.replyFont
      const appearance = settings.appearance
      const root = document.documentElement
      root.dataset.density = appearance.density
      root.dataset.accent = appearance.accent
      root.dataset.motion = appearance.motion
      for (const [name, value] of Object.entries({
        '--ui-font-size': appearance.fontSize,
        '--sidebar-font-size': appearance.sidebarFontSize,
        '--control-radius': appearance.cornerRadius,
        '--content-gutter': appearance.contentPadding,
        '--message-spacing': appearance.messageSpacing,
        '--composer-max-height': appearance.composerMaxHeight
      }))
        root.style.setProperty(name, `${value}px`)
      document.documentElement.style.colorScheme = theme
      document.documentElement.style.setProperty(
        '--interface-font-family',
        interfaceFontFamily(settings.interfaceFont)
      )
      document.documentElement.style.setProperty(
        '--reply-font-family',
        interfaceFontFamily(settings.replyFont)
      )
      document.documentElement.lang = settings.language
      document.documentElement.style.setProperty(
        '--code-font-family',
        terminalFontFamily(settings.code.font)
      )
      document.documentElement.style.setProperty('--code-font-size', `${settings.code.fontSize}px`)
      document.documentElement.style.setProperty(
        '--code-line-height',
        String(settings.code.lineHeight)
      )
      setResolvedTheme(theme)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings])

  const refreshSessions = useCallback(
    (requested?: string): Promise<RemoteSession[] | undefined> => {
      const id = requested ?? useAppStore.getState().settings?.currentProfileId
      if (!id) return Promise.resolve(undefined)
      const pending = loads.current.get(id)
      if (pending) return pending
      const source = useAppStore.getState().settings?.profiles.find((p) => p.id === id)
      setLoadingProfiles((ids) => [...ids, id])
      const request = window.claudeBridge.sessions
        .list(id)
        .then((found) => {
          const current = useAppStore.getState().settings?.profiles.find((p) => p.id === id)
          if (!source || !current || connectionIdentity(source) !== connectionIdentity(current))
            return undefined
          useAppStore.getState().setSessions(found, id)
          setListErrors((errors) => ({ ...errors, [id]: '' }))
          return found
        })
        .catch((error) => {
          setListErrors((errors) => ({ ...errors, [id]: messageFrom(error) }))
          return undefined
        })
        .finally(() => {
          loads.current.delete(id)
          setLoadingProfiles((ids) => ids.filter((item) => item !== id))
        })
      loads.current.set(id, request)
      return request
    },
    []
  )

  const attachTarget = useCallback(
    async (
      target: SessionTarget,
      readOnly?: boolean,
      takeover = false,
      force = false
    ): Promise<void> => {
      const key = targetKey(target)
      const source = useAppStore
        .getState()
        .settings?.profiles.find((p) => p.id === target.profileId)
      if (!source) return
      const observation =
        readOnly ??
        useWorkspacePreferences.getState().projects[target.profileId]?.sessions[target.sessionName]
          ?.readOnly ??
        false
      const current = useAppStore.getState().statuses[key]
      if (attaching.current.has(key)) return
      if (
        !force &&
        !takeover &&
        current &&
        ['attached', 'connecting', 'checking', 'reconnecting'].includes(current.state)
      )
        return
      attaching.current.add(key)
      try {
        if (current && (force || takeover)) await window.claudeBridge.sessions.detach(target)
        const status = await window.claudeBridge.sessions.attach({
          ...target,
          readOnly: observation,
          detachOtherClients: takeover
        })
        const profile = useAppStore
          .getState()
          .settings?.profiles.find((p) => p.id === target.profileId)
        if (!profile || connectionIdentity(source) !== connectionIdentity(profile)) return
        const latest = useAppStore.getState().statuses[key]
        if (!latest || status.changedAt >= latest.changedAt)
          useAppStore.getState().setStatus(status)
        if (
          status.state === 'attached' &&
          source &&
          profile &&
          connectionIdentity(source) === connectionIdentity(profile)
        )
          useWorkspacePreferences
            .getState()
            .updateSession(profile, target.sessionName, { readOnly: observation })
      } catch (error) {
        const profile = useAppStore
          .getState()
          .settings?.profiles.find((p) => p.id === target.profileId)
        if (!profile || connectionIdentity(source) !== connectionIdentity(profile)) return
        useAppStore.getState().setStatus({
          ...target,
          state: 'failed',
          readOnly: observation,
          attempt: 0,
          changedAt: Date.now(),
          message: messageFrom(error)
        })
      } finally {
        attaching.current.delete(key)
      }
    },
    []
  )

  useEffect(() => {
    let active = true
    let pending: { target: SessionTarget; event: TimelineEvent }[] = []
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => {
      flushTimer = undefined
      // Yield between replay chunks so input/paint is not blocked by one huge commit.
      const entries = pending.splice(0, 100)
      if (active && entries.length) useAppStore.getState().addTimelineEvents(entries)
      if (active && pending.length) flushTimer = setTimeout(flush, 32)
    }
    const unsubscribe = window.claudeBridge.events.subscribe((event) => {
      const state = useAppStore.getState()
      const id =
        event.type === 'session-status'
          ? event.status.profileId
          : 'target' in event
            ? event.target.profileId
            : undefined
      if (id && state.settings && !state.settings.profiles.some((p) => p.id === id)) return
      if (event.type === 'app-action') {
        if (event.action === 'new-chat') {
          if (state.settings?.profiles.length) {
            setCreateProfileId(state.settings.currentProfileId)
            setCreateOpen(true)
          } else setProfileEditor('new')
        } else if (event.action === 'servers') {
          ++navigationRequest.current
          setPage('servers')
        } else if (event.action === 'settings') setSettingsOpen(true)
        else if (event.action === 'diagnostics') setDiagnosticsOpen(true)
      } else if (event.type === 'focus-session')
        void notificationNavigate.current(event.target.profileId, event.target)
      else if (event.type === 'upload-progress')
        state.setUploadProgress(event.target, event.progress)
      else if (event.type === 'session-status') state.setStatus(event.status)
      else if (event.type === 'transcript-status')
        state.setTranscriptStatus(event.target, event.status)
      else if (event.type === 'timeline-event') {
        pending.push({ target: event.target, event: event.event })
        flushTimer ??= setTimeout(flush, 32)
      } else if (event.type === 'timeline-reset') {
        pending = pending.filter((entry) => targetKey(entry.target) !== targetKey(event.target))
        state.resetTimeline(event.target)
      } else if (event.type === 'notification')
        state.showToast({ level: event.level, title: event.title, body: event.body })
      else if (event.type === 'pty-data') state.appendTerminalData(event.target, event.data)
    })
    void window.claudeBridge.settings
      .get()
      .then(async (loaded) => {
        if (!active) return
        useWorkspacePreferences.getState().reconcile(loaded.profiles)
        const last = useWorkspacePreferences.getState().lastTarget
        useAppStore
          .getState()
          .setSettings(last ? { ...loaded, currentProfileId: last.profileId } : loaded)
        if (!last || restoreStarted.current) return
        restoreStarted.current = true
        useAppStore.getState().select(last)
        setPage('workspace')
        const found = await refreshSessions(last.profileId)
        if (!active || targetKey(useAppStore.getState().selected ?? last) !== targetKey(last))
          return
        if (found?.some((session) => session.name === last.sessionName)) await attachTarget(last)
        else if (found) {
          useWorkspacePreferences.getState().forget(last)
          setListErrors((errors) => ({
            ...errors,
            [last.profileId]: translate(loaded.language, 'work.restoreMissing')
          }))
        }
      })
      .catch((error) => {
        if (active) setBootError(messageFrom(error))
      })
    return () => {
      active = false
      clearTimeout(flushTimer)
      pending = []
      unsubscribe()
    }
  }, [attachTarget, refreshSessions])

  useEffect(() => {
    if (page !== 'workspace' || !activeProfileId) return
    let active = true
    void refreshSessions(activeProfileId)
    void window.claudeBridge.helper
      .status(activeProfileId)
      .then((result) => {
        if (active) setHelperResult({ connection: activeConnection, installed: result.installed })
      })
      .catch(() => {
        if (active) setHelperResult({ connection: activeConnection, installed: false })
      })
    return () => {
      active = false
    }
  }, [page, activeProfileId, activeConnection, refreshSessions])

  useEffect(() => {
    if (!toast || toast.level === 'error') return
    const timer = setTimeout(() => useAppStore.getState().clearToast(), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        document.querySelector('[aria-modal="true"]') ||
        page !== 'workspace'
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('.xterm') &&
        useAppStore.getState().directControl
      )
        return
      if (
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === 'Backquote'
      ) {
        event.preventDefault()
        const state = useAppStore.getState()
        const visible =
          state.terminalOpen &&
          (state.workspaceMode === 'terminal' ||
            (state.rightPanelOpen && state.rightPanel === 'terminal'))
        state.setTerminalOpen(!visible)
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.cm-content')?.focus())
      }
    }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [page])

  const saveSettings = async (next: AppSettings): Promise<void> => {
    const saved = await window.claudeBridge.settings.update(next)
    useWorkspacePreferences.getState().reconcile(saved.profiles)
    store().setSettings(saved)
  }
  // Profile writes are serialized; a slow earlier click cannot overwrite the later destination.
  const navigate = async (id: string, target?: SessionTarget): Promise<void> => {
    const ticket = ++navigationRequest.current
    const operation = navigationQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (ticket !== navigationRequest.current) return
        const current = store().settings
        if (!current?.profiles.some((p) => p.id === id)) return
        if (current.currentProfileId !== id)
          await saveSettings({ ...current, currentProfileId: id })
        if (ticket !== navigationRequest.current) return
        if (target) store().select(target)
        setPage('workspace')
      })
    navigationQueue.current = operation
    try {
      await operation
      if (ticket !== navigationRequest.current) return
      const current = store().settings?.profiles.find((p) => p.id === id)
      if (target && current) {
        useWorkspacePreferences
          .getState()
          .remember(
            current,
            target.sessionName,
            store().sessionsByProfile[id]?.find((session) => session.name === target.sessionName)
              ?.currentPath
          )
        void attachTarget(target)
      }
      await refreshSessions(id)
    } catch (error) {
      store().showToast({
        level: 'error',
        title: t('app.settingsFailed'),
        body: messageFrom(error)
      })
    }
  }
  const openProject = async (id: string): Promise<void> => {
    const known = store().selectedByProfile[id]
    const remembered = useWorkspacePreferences.getState().projects[id]?.sessions
    const name =
      known && remembered?.[known]
        ? known
        : Object.entries(remembered ?? {}).sort(
            (a, b) => (b[1].lastOpened ?? 0) - (a[1].lastOpened ?? 0)
          )[0]?.[0]
    await navigate(id, name ? { profileId: id, sessionName: name } : undefined)
  }
  useEffect(() => {
    notificationNavigate.current = navigate
  })
  const detach = async (): Promise<void> => {
    if (!selected) return
    try {
      await window.claudeBridge.sessions.detach(selected)
      store().setDirectControl(false)
    } catch (error) {
      store().showToast({ level: 'error', title: t('work.disconnect'), body: messageFrom(error) })
    }
  }
  const terminate = async (target: SessionTarget, confirmation: string): Promise<void> => {
    await window.claudeBridge.sessions.terminate(target, confirmation)
    store().clearSessionData(target)
    useWorkspacePreferences.getState().forget(target)
    localStorage.removeItem(`clb:draft:${targetKey(target)}`)
    await refreshSessions(target.profileId)
  }
  const renameSession = async (old: SessionTarget, newName: string): Promise<void> => {
    const profile = store().settings?.profiles.find((item) => item.id === old.profileId)
    if (!profile) return
    const status = store().statuses[targetKey(old)]
    if (status && ['attached', 'checking', 'connecting', 'reconnecting'].includes(status.state))
      return
    const preference =
      useWorkspacePreferences.getState().projects[profile.id]?.sessions[old.sessionName]
    const renamed = await window.claudeBridge.sessions.rename({ ...old, newName })
    const next = { profileId: old.profileId, sessionName: renamed.name }
    for (const prefix of ['clb:draft:', 'clb:history:']) {
      const data = localStorage.getItem(prefix + targetKey(old))
      if (data !== null) {
        localStorage.setItem(prefix + targetKey(next), data)
        localStorage.removeItem(prefix + targetKey(old))
      }
    }
    store().clearSessionData(old)
    useWorkspacePreferences.getState().forget(old)
    if (preference)
      useWorkspacePreferences.getState().updateSession(profile, next.sessionName, preference)
    useWorkspacePreferences.getState().remember(profile, next.sessionName, renamed.currentPath)
    if (store().selected && targetKey(store().selected!) === targetKey(old)) store().select(next)
    await refreshSessions(profile.id)
  }
  const createSession = async (request: CreateSessionRequest, title?: string): Promise<void> => {
    const profile = store().settings?.profiles.find((item) => item.id === request.profileId)
    if (!profile) throw new Error(t('create.serverMissing'))
    const { cwd } = request
    const helper = await window.claudeBridge.helper.status(profile.id)
    if (!helper.installed) {
      await window.claudeBridge.helper.install(profile.id)
      setHelperResult({ connection: connectionIdentity(profile), installed: true })
    }
    // Switch only on submission; browsing other servers leaves the current chat intact.
    const current = store().settings!
    if (current.currentProfileId !== profile.id)
      await saveSettings({ ...current, currentProfileId: profile.id })
    const created = await window.claudeBridge.sessions.create(request)
    const target = { profileId: profile.id, sessionName: created.name }
    store().clearSessionData(target)
    useWorkspacePreferences.getState().forget(target)
    useWorkspacePreferences
      .getState()
      .updateSession(profile, created.name, { title: title?.trim() || undefined })
    useWorkspacePreferences.getState().remember(profile, created.name, created.currentPath || cwd)
    store().select(target)
    setPage('workspace')
    await refreshSessions(profile.id)
    await attachTarget(target)
  }
  const saveProfile = async (next: Profile): Promise<void> => {
    const current = store().settings
    if (!current) return
    const exists = current.profiles.some((p) => p.id === next.id)
    if (!exists && current.profiles.length >= MAX_PROFILES) throw new Error(t('library.limit'))
    await saveSettings({
      ...current,
      currentProfileId: current.currentProfileId || next.id,
      profiles: exists
        ? current.profiles.map((p) => (p.id === next.id ? next : p))
        : [...current.profiles, next]
    })
  }
  const removeProfile = async (id: string): Promise<void> => {
    ++navigationRequest.current
    const operation = navigationQueue.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await window.claudeBridge.profiles.remove(id)
        useWorkspacePreferences.getState().reconcile(saved.profiles)
        store().setSettings(saved)
        setListErrors((errors) => {
          const next = { ...errors }
          delete next[id]
          return next
        })
        setPage('servers')
      })
    navigationQueue.current = operation
    await operation
  }
  const importServers = async (): Promise<void> => {
    const result = await window.claudeBridge.profiles.importSshConfig()
    const saved = await window.claudeBridge.settings.get()
    useWorkspacePreferences.getState().reconcile(saved.profiles)
    store().setSettings(saved)
    store().showToast({
      level: 'info',
      title: t('library.import'),
      body: t('library.importResult', { count: result.imported })
    })
  }
  const toggleTheme = async (): Promise<void> => {
    const current = store().settings
    if (!current) return
    try {
      await saveSettings({ ...current, theme: resolvedTheme === 'dark' ? 'light' : 'dark' })
    } catch (error) {
      store().showToast({
        level: 'error',
        title: t('app.settingsFailed'),
        body: messageFrom(error)
      })
    }
  }

  const toggleReadingWidth = async (): Promise<void> => {
    const current = store().settings
    if (!current) return
    try {
      await saveSettings({
        ...current,
        conversation: {
          ...current.conversation,
          widthMode: current.conversation.widthMode === 'limited' ? 'full' : 'limited'
        }
      })
    } catch (error) {
      store().showToast({
        level: 'error',
        title: t('app.settingsFailed'),
        body: messageFrom(error)
      })
    }
  }

  if (!settings)
    return (
      <main className="boot-screen">
        {bootError ? (
          <div role="alert">
            <p>{t('app.loadingFailed')}</p>
            <p>{bootError}</p>
            <button className="secondary-button" onClick={() => window.location.reload()}>
              {t('work.retry')}
            </button>
          </div>
        ) : (
          <>
            <RefreshCw className="spin" /> {t('app.loading')}
          </>
        )}
      </main>
    )
  const showTerminal = (): void =>
    store().setWorkspaceMode(workspaceMode === 'terminal' ? 'terminal' : 'split')
  const reconnect = (): void => {
    if (selected) void attachTarget(selected, selectedStatus?.readOnly, false, true)
  }
  let notice:
    | {
        title: string
        body: string
        action?: string
        actionId?: 'reconnect' | 'interact' | 'terminal' | 'diagnostics'
        level?: string
      }
    | undefined
  if (selectedStatus?.state === 'reconnecting')
    notice = { title: t('work.reconnecting'), body: t('work.reconnectingBody') }
  else if (selectedStatus?.state === 'failed')
    notice = {
      title: t('app.connectFailed'),
      body: selectedStatus.message ?? t('work.unknown'),
      action: t('work.reconnect'),
      actionId: 'reconnect',
      level: 'error'
    }
  else if (selectedStatus?.state === 'detached')
    notice = {
      title: t('work.detached'),
      body: t('work.detachedBody'),
      action: t('work.reconnect'),
      actionId: 'reconnect'
    }
  else if (connected && selectedStatus.readOnly)
    notice = {
      title: t('work.readOnly'),
      body: t('work.readOnlyBody'),
      action: t('work.interact'),
      actionId: 'interact'
    }
  else if (connected && selectedStatus.promptState !== 'ready')
    notice = {
      title: t(
        selectedStatus.promptState === 'confirmation' ? 'work.confirmation' : 'work.checking'
      ),
      body: selectedStatus.promptMessage ?? t('work.blocked'),
      action: t('session.inspectTerminal'),
      actionId: 'terminal'
    }
  else if (connected && helperInstalled === false)
    notice = {
      title: t('sidebar.diagnostics'),
      body: t('helper.banner'),
      action: t('helper.open'),
      actionId: 'diagnostics'
    }
  const listError = profile ? listErrors[profile.id] : undefined

  const label = (zh: string, en: string): string => (language === 'zh-CN' ? zh : en)
  const windowCommand = (command: WindowCommand): void => {
    void window.bridgeWindow.execute(command).catch((error) =>
      store().showToast({
        level: 'error',
        title: label('操作失败', 'Command failed'),
        body: messageFrom(error)
      })
    )
  }
  const manageServers = (): void => {
    ++navigationRequest.current
    setPage('servers')
  }
  const readingWidthLabel =
    settings.conversation.widthMode === 'limited'
      ? label('切换到全宽阅读', 'Use full reading width')
      : label('切换到居中阅读', 'Use centered reading width')
  const available = sessionCommands(selectedSession, selectedStatus)
  const menus: AppMenu[] = [
    {
      id: 'file',
      label: label('文件', 'File'),
      items: [
        { id: 'new', label: t('work.new'), run: openCreate },
        { id: 'servers', label: label('管理服务器', 'Manage servers'), run: manageServers },
        {
          id: 'upload',
          label: t('composer.upload'),
          disabled:
            page !== 'workspace' ||
            !canUpload(
              selected,
              connected,
              !!selectedStatus?.readOnly,
              !!(selected && composerBusy[targetKey(selected)]?.uploading)
            ),
          reason:
            page !== 'workspace' || !selected || !connected
              ? t('composer.connectFirst')
              : selectedStatus?.readOnly
                ? label('只读会话不能上传文件', 'Read-only sessions cannot upload files')
                : label('正在上传文件，请稍候', 'A file upload is in progress'),
          run: () => runWorkspaceCommand('upload')
        },
        { id: 'settings', label: t('sidebar.settings'), run: () => setSettingsOpen(true) },
        {
          id: 'close',
          label: label('关闭窗口', 'Close window'),
          run: () => windowCommand('close')
        },
        {
          id: 'quit',
          label: label('退出应用', 'Quit application'),
          run: () => windowCommand('quit')
        }
      ]
    },
    {
      id: 'edit',
      label: label('编辑', 'Edit'),
      items: [
        ...[
          ['undo', '撤销', 'Undo'],
          ['redo', '重做', 'Redo'],
          ['cut', '剪切', 'Cut'],
          ['copy', '复制', 'Copy'],
          ['paste', '粘贴', 'Paste'],
          ['selectAll', '全选', 'Select all']
        ].map(([id, zh, en]) => ({
          id: id!,
          label: label(zh!, en!),
          run: () => windowCommand(id as WindowCommand)
        })),
        {
          id: 'focus-input',
          label: label('聚焦输入框', 'Focus input'),
          disabled: !hasSession,
          run: () => {
            setPage('workspace')
            store().setWorkspaceMode('conversation')
            requestAnimationFrame(() => runWorkspaceCommand('focus-input'))
          }
        }
      ]
    },
    {
      id: 'view',
      label: label('视图', 'View'),
      items: [
        { id: 'reading-width', label: readingWidthLabel, run: () => void toggleReadingWidth() },
        {
          id: 'sidebar',
          label: label('展开 / 收起侧栏', 'Toggle sidebar'),
          run: () =>
            useWorkspacePreferences
              .getState()
              .setCollapsed(!useWorkspacePreferences.getState().collapsed)
        },
        ...(['conversation', 'split', 'terminal'] as const).map((mode) => ({
          id: mode,
          label: t(`workspace.${mode}`),
          disabled: !profile,
          run: () => {
            setPage('workspace')
            store().setWorkspaceMode(mode)
          }
        })),
        {
          id: 'find',
          label: t('timeline.search'),
          disabled: !hasSession || !events?.length,
          run: () => {
            setPage('workspace')
            store().setWorkspaceMode('conversation')
            requestAnimationFrame(() => runWorkspaceCommand('find-conversation'))
          }
        },
        {
          id: 'latest',
          label: t('timeline.jumpToLatest'),
          disabled: !hasSession,
          run: () => {
            setPage('workspace')
            store().setWorkspaceMode('conversation')
            requestAnimationFrame(() => runWorkspaceCommand('latest'))
          }
        },
        {
          id: 'theme',
          label: t(resolvedTheme === 'dark' ? 'statusbar.light' : 'statusbar.dark'),
          run: () => void toggleTheme()
        },
        { id: 'zoomIn', label: label('放大', 'Zoom in'), run: () => windowCommand('zoomIn') },
        { id: 'zoomOut', label: label('缩小', 'Zoom out'), run: () => windowCommand('zoomOut') },
        {
          id: 'zoomReset',
          label: label('实际大小 (100%)', 'Actual size (100%)'),
          run: () => windowCommand('zoomReset')
        }
      ]
    },
    {
      id: 'session',
      label: label('会话', 'Session'),
      items: [
        {
          id: 'edit-title',
          label: t('work.editTitle'),
          disabled: !hasSession || page !== 'workspace',
          run: () => runWorkspaceCommand('edit-title')
        },
        {
          id: 'pin',
          label: t(
            selected && workspacePrefs[selected.profileId]?.sessions[selected.sessionName]?.pinned
              ? 'work.unpin'
              : 'work.pin'
          ),
          disabled: !hasSession,
          run: () => {
            if (selected && profile)
              useWorkspacePreferences.getState().updateSession(profile, selected.sessionName, {
                pinned: !workspacePrefs[selected.profileId]?.sessions[selected.sessionName]?.pinned
              })
          }
        },
        {
          id: 'observe',
          label: t('work.observe'),
          disabled: !available.observe,
          reason: label(
            '需要可写会话；当前可能已是只读模式',
            'Requires a writable session; it may already be read-only'
          ),
          run: () => {
            if (selected) void attachTarget(selected, true, false, true)
          }
        },
        {
          id: 'takeover',
          label: t('sidebar.takeover'),
          disabled: !available.takeover,
          reason: label('没有其他已连接的客户端', 'No other connected clients'),
          run: () => setTakeoverSession(selectedSession)
        },
        {
          id: 'refresh',
          label: t('work.retry'),
          disabled: !profile,
          run: () => void refreshSessions()
        },
        { id: 'reconnect', label: t('work.reconnect'), disabled: !selected, run: reconnect },
        {
          id: 'disconnect',
          label: t('work.disconnect'),
          disabled: !available.disconnect,
          reason: label('当前没有本地连接', 'No active local connection'),
          run: () => void detach()
        },
        {
          id: 'rename',
          label: t('work.renameRemote'),
          disabled: !available.rename,
          reason: label('请先断开本地连接再重命名', 'Disconnect locally before renaming'),
          run: () => selected && setSessionAction({ action: 'rename', target: selected })
        },
        {
          id: 'terminate',
          label: t('work.terminate'),
          disabled: !available.terminate,
          run: () => selected && setSessionAction({ action: 'terminate', target: selected })
        }
      ]
    },
    {
      id: 'help',
      label: label('帮助', 'Help'),
      items: [
        {
          id: 'diagnostics',
          label: t('sidebar.diagnostics'),
          disabled: !profile,
          run: () => setDiagnosticsOpen(true)
        },
        {
          id: 'about',
          label: label('关于', 'About'),
          run: () => {
            void window.claudeBridge.app
              .getVersion()
              .then((version) =>
                store().showToast({ level: 'info', title: 'Conlaude', body: version })
              )
          }
        }
      ]
    }
  ]

  return (
    <div
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      className={`app-shell task-workspace workspace-mode-${workspaceMode === 'terminal' ? 'bottom' : workspaceMode} ${terminalOpen ? 'terminal-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}
    >
      <AppTitleBar
        menus={menus}
        panelControls={
          <div
            className="panel-visibility-controls"
            role="group"
            aria-label={label('面板布局', 'Panel layout')}
          >
            <button
              className="icon-button sidebar-visibility-toggle"
              aria-label={label('底部栏', 'Bottom panel')}
              title={label('底部栏', 'Bottom panel')}
              aria-pressed={bottomOpen}
              aria-expanded={bottomOpen}
              aria-controls="terminal-panel"
              disabled={!hasSession || page !== 'workspace'}
              onClick={() => store().setWorkspaceMode(bottomOpen ? 'conversation' : 'terminal')}
            >
              <SidebarToggleIcon side="bottom" />
            </button>
            <button
              className="icon-button sidebar-visibility-toggle"
              data-open-files
              aria-label={label('右侧栏', 'Right sidebar')}
              title={label('右侧栏', 'Right sidebar')}
              aria-pressed={rightOpen}
              aria-expanded={rightOpen}
              aria-controls="right-panel-content"
              disabled={!hasSession || page !== 'workspace'}
              onClick={toggleRight}
            >
              <SidebarToggleIcon side="right" />
            </button>
          </div>
        }
        unavailableReason={
          profile
            ? label('请先打开一个会话', 'Open a session first')
            : label('请先选择服务器', 'Select a server first')
        }
      >
        {page === 'workspace' && profile ? (
          <SessionHeader
            onToggleReadingWidth={() => void toggleReadingWidth()}
            readingWidthLabel={readingWidthLabel}
            key={selected ? targetKey(selected) : profile.id}
            profile={profile}
            target={hasSession ? selected : undefined}
            session={selectedSession}
            status={selectedStatus}
            onReconnect={reconnect}
            onDisconnect={() => void detach()}
            onObserve={() => {
              if (selected) void attachTarget(selected, true, false, true)
            }}
            onTakeover={() => setTakeoverSession(selectedSession)}
            onTerminate={() =>
              selected && setSessionAction({ action: 'terminate', target: selected })
            }
            onRenameRemote={() =>
              selected && setSessionAction({ action: 'rename', target: selected })
            }
          />
        ) : undefined}
      </AppTitleBar>
      <WorkspaceSidebar
        profiles={settings.profiles}
        currentProfileId={settings.currentProfileId}
        page={profile ? page : 'servers'}
        loading={!!profile && loadingProfiles.includes(profile.id)}
        onOpen={(target) => void navigate(target.profileId, target)}
        onLoadProfile={(id) => void refreshSessions(id)}
        onNew={openCreate}
        onManage={() => {
          ++navigationRequest.current
          setPage('servers')
        }}
        onRefresh={() => void refreshSessions()}
        onSettings={() => setSettingsOpen(true)}
        onDiagnostics={() => setDiagnosticsOpen(true)}
        onEditProfile={(profile) => {
          setSettingsProfileId(profile.id)
          setSettingsOpen(true)
        }}
        onDeleteProfile={removeProfile}
        onTerminate={(target) => setSessionAction({ action: 'terminate', target })}
      />
      {(page === 'servers' || !profile) && (
        <div className="library-frame">
          {useWorkspacePreferences.getState().lastTarget && (
            <button className="library-return quiet-button" onClick={() => setPage('workspace')}>
              <ArrowLeft size={16} />
              {t('work.return')}
            </button>
          )}
          <ServerLibrary
            settings={settings}
            statuses={statuses}
            onOpen={openProject}
            onAdd={() => setProfileEditor('new')}
            onEdit={setProfileEditor}
            onDelete={removeProfile}
            onImport={importServers}
          />
        </div>
      )}
      {profile && (
        <div
          data-maximized={maximizedPanel}
          className={`workspace-frame dock-layout ${rightFiles || rightTerminal ? 'dock-right' : ''} ${rightFiles ? 'files-open' : ''} ${rightTerminal ? 'dock-right-terminal' : ''} ${terminalOpen && workspaceMode === 'terminal' ? 'dock-bottom' : ''}`}
          style={{ '--dock-width': dockWidth ? `${dockWidth}px` : '46%' } as CSSProperties}
          hidden={page !== 'workspace'}
        >
          <main className="workspace">
            <div className="workspace-notices">
              {page === 'workspace' && listError && (
                <WorkspaceNotice
                  key={`${activeConnection}:list:${listError}`}
                  title={t('work.loadError')}
                  body={listError}
                  level="error"
                  action={t('work.retry')}
                  onAction={() => void refreshSessions()}
                />
              )}
              {page === 'workspace' && notice && (
                <WorkspaceNotice
                  key={`${selected ? targetKey(selected) : activeConnection}:${selectedStatus?.state}:${notice.actionId}:${notice.body}`}
                  {...notice}
                  onAction={() => {
                    if (notice.actionId === 'reconnect') reconnect()
                    else if (notice.actionId === 'interact' && selected)
                      void attachTarget(selected, false, false, true)
                    else if (notice.actionId === 'terminal') showTerminal()
                    else setDiagnosticsOpen(true)
                  }}
                />
              )}
            </div>
            <div
              className="conversation-area"
              style={
                {
                  '--reading-max-width':
                    settings.conversation.widthMode === 'limited'
                      ? `${settings.conversation.maxWidth}px`
                      : 'none'
                } as CSSProperties
              }
            >
              {hasSession ? (
                <RemoteFileOpenContext.Provider
                  value={(reference) => openRemoteReference(reference)}
                >
                  <Timeline
                    key={`timeline:${targetKey(selected!)}`}
                    sessionKey={targetKey(selected!)}
                    events={events ?? EMPTY_EVENTS}
                    connected={connected}
                    active={page === 'workspace'}
                  />
                </RemoteFileOpenContext.Provider>
              ) : (
                <div className="workspace-welcome">
                  <BrandLogo className="welcome-logo" />
                  <h2>{t('work.start')}</h2>
                  <p>{t('work.startBody')}</p>
                  <span>
                    {projectName(profile)} · {profile.sshHost ?? profile.host}
                  </span>
                  <button className="primary-button" onClick={() => openCreate()}>
                    <Plus size={16} />
                    {t('work.new')}
                  </button>
                </div>
              )}
              <Composer
                statusBarHost={composerStatusHost}
                key={`composer:${hasSession ? targetKey(selected!) : 'no-session'}`}
                target={hasSession ? selected : undefined}
                connected={connected}
                readOnly={selectedStatus?.readOnly ?? false}
                promptBlocked={selectedStatus?.promptState !== 'ready'}
                active={page === 'workspace'}
              />
            </div>
          </main>
          <PanelDock
            maximized={maximizedPanel === 'right'}
            onMaximize={() => setMaximizedPanel(maximizedPanel === 'right' ? undefined : 'right')}
            rightOpen={rightOpen}
            bottomOpen={bottomOpen}
            active={rightTerminal ? 'terminal' : 'files'}
            onFiles={() => {
              if (rightFiles) store().setRightPanelOpen(false)
              else selectFiles()
            }}
            onTerminal={() => {
              if (rightTerminal) store().setRightPanelOpen(false)
              else store().setWorkspaceMode('split')
            }}
            onClose={() => {
              store().setRightPanelOpen(false)
              document.querySelector<HTMLButtonElement>('[data-open-files]')?.focus()
            }}
          >
            <TerminalPanel
              maximized={maximizedPanel === 'bottom'}
              onMaximize={() =>
                setMaximizedPanel(maximizedPanel === 'bottom' ? undefined : 'bottom')
              }
              target={hasSession ? selected : undefined}
              connected={connected}
              readOnly={selectedStatus?.readOnly ?? false}
              visible={rightTerminal || (terminalOpen && workspaceMode === 'terminal')}
              docked={workspaceMode !== 'terminal'}
            />
            <Suspense fallback={null}>
              <FileWorkspace
                files={fileWorkspaces}
                activeFileId={activeFileId}
                openRevision={fileOpenRevision}
                visible={rightFiles}
                onSelect={(id) => {
                  setActiveFileId(id)
                  store().setRightPanel('files')
                }}
                onClose={closeFile}
                onOpen={(path, source) => openRemoteReference(path, source)}
                onFileState={(id, state) =>
                  setFileWorkspaces((items) => {
                    const current = items.find((item) => item.id === id)
                    if (!current || (current.file === state.path && current.dirty === state.dirty))
                      return items
                    return items.map((item) =>
                      item.id === id ? { ...item, file: state.path, dirty: state.dirty } : item
                    )
                  })
                }
              />
            </Suspense>
          </PanelDock>
          <footer className="status-bar">
            <div className="status-bar-composer" ref={setComposerStatusHost} />
            <div className="status-bar-group">
              <button
                onClick={() => void toggleTheme()}
                title={t(resolvedTheme === 'dark' ? 'statusbar.light' : 'statusbar.dark')}
                aria-label={t(resolvedTheme === 'dark' ? 'statusbar.light' : 'statusbar.dark')}
              >
                {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </footer>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.level}`} role="status">
          <div>
            <strong>{toast.title}</strong>
            {toast.body && <FeedbackText key={toast.id} text={toast.body} />}
          </div>
          <button
            className="icon-button"
            onClick={() => store().clearToast()}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {profileEditor && (
        <ProfileEditor
          profile={profileEditor === 'new' ? undefined : profileEditor}
          onClose={() => setProfileEditor(undefined)}
          onSave={saveProfile}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          initialProfileId={settingsProfileId}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsProfileId(undefined)
          }}
          onSave={saveSettings}
          onPreview={(next) => store().setSettings(next)}
        />
      )}
      {diagnosticsOpen && profile && (
        <DiagnosticsDialog
          key={profile.id}
          profileId={profile.id}
          onClose={() => setDiagnosticsOpen(false)}
          onInstalled={() => setHelperResult({ connection: activeConnection, installed: true })}
        />
      )}
      {createOpen && settings.profiles.length > 0 && (
        <CreateSessionDialog
          profiles={settings.profiles}
          initialProfileId={createProfileId ?? profile?.id ?? settings.profiles[0]!.id}
          onClose={() => setCreateOpen(false)}
          onCreate={createSession}
        />
      )}
      {sessionAction && (
        <SessionActionDialog
          action={sessionAction.action}
          target={sessionAction.target}
          onClose={() => setSessionAction(undefined)}
          onRename={(name) => renameSession(sessionAction.target, name)}
          onTerminate={(confirmation) => terminate(sessionAction.target, confirmation)}
        />
      )}
      {takeoverSession && profile && (
        <Modal
          className="small-modal"
          label={t('takeover.label')}
          onClose={() => setTakeoverSession(undefined)}
        >
          <header className="modal-header">
            <div>
              <h2>{t('takeover.title', { session: takeoverSession.name })}</h2>
              <p>{t('takeover.detail', { count: takeoverSession.attachedClients })}</p>
            </div>
          </header>
          <footer className="modal-footer">
            <button className="secondary-button" onClick={() => setTakeoverSession(undefined)}>
              {t('common.cancel')}
            </button>
            <button
              className="primary-button"
              onClick={() => {
                const target = { profileId: profile.id, sessionName: takeoverSession.name }
                setTakeoverSession(undefined)
                void attachTarget(target, false, true, true)
              }}
            >
              {t('takeover.confirm')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  )
}
