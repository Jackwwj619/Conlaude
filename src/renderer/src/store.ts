import { create } from 'zustand'
import { connectionIdentity } from '../../shared/profile-identity'
import { presentTurn } from './conversation-turns'
import type {
  AppSettings,
  ClaudePermissionMode,
  RemoteSession,
  SessionStatus,
  SessionTarget,
  TimelineEvent,
  TranscriptStatus,
  UploadProgress
} from '../../shared/contracts'

const TERMINAL_OPEN_KEY = 'clb:ui:terminal-open'
const WORKSPACE_MODE_KEY = 'clb:ui:workspace-mode'
export type WorkspaceMode = 'conversation' | 'split' | 'terminal'

function initialWorkspaceMode(): WorkspaceMode {
  const saved = localStorage.getItem(WORKSPACE_MODE_KEY)
  if (saved === 'conversation' || saved === 'split' || saved === 'terminal') return saved
  return localStorage.getItem(TERMINAL_OPEN_KEY) === 'true' ? 'split' : 'conversation'
}

export function targetKey(target: SessionTarget): string {
  return `${target.profileId}:${target.sessionName}`
}

function isLocalUserEvent(event: TimelineEvent): boolean {
  return event.kind === 'user' && event.id.startsWith('local-')
}

function normalizedUserText(text: string): string {
  // The terminal transport normalizes line endings before Claude records the transcript.
  // Ignore only trailing whitespace so Markdown content is otherwise compared exactly.
  const normalized = text.replace(/\r\n?/g, '\n')
  const imagePath =
    /(?:^|\n)\/[^\n]*\/\.local\/share\/claude-local-bridge\/uploads\/[^\n]+\.(?:png|jpe?g|gif|webp)(?=\n|$)/gi
  const paths = normalized.match(imagePath)
  if (paths)
    return `${'[Image]'.repeat(paths.length)}${normalized.replace(imagePath, '').trimEnd()}`
  return normalized.replace(/\[Image #\d+\]/g, '[Image]').trimEnd()
}

// A replay batch copies a session's history once and indexes IDs/echoes once.
// Repeated findIndex + array copies for every row made replay quadratic.
function timelineBatch(previous: TimelineEvent[]) {
  const events = [...previous]
  const ids = new Map(events.map((event, index) => [event.id, index]))
  const messageEnds = new Map<string, number>()
  events.forEach((event, index) => {
    if (event.messageId) messageEnds.set(event.messageId, index)
  })
  const localEchoes = new Map<string, Set<number>>()
  const remoteEchoes = new Map<string, Set<number>>()
  const indexEcho = (event: TimelineEvent, index: number, remove = false): void => {
    if (event.kind !== 'user' || !event.text) return
    const map = isLocalUserEvent(event) ? localEchoes : remoteEchoes
    const text = normalizedUserText(event.text)
    if (remove) {
      map.get(text)?.delete(index)
      return
    }
    const indices = map.get(text) ?? new Set<number>()
    indices.add(index)
    map.set(text, indices)
  }
  events.forEach((event, index) => indexEcho(event, index))
  const replace = (index: number, event: TimelineEvent): void => {
    const previous = events[index]!
    ids.delete(previous.id)
    indexEcho(previous, index, true)
    events[index] = event
    ids.set(event.id, index)
    indexEcho(event, index)
  }
  const add = (event: TimelineEvent): void => {
    // A new real user message can branch from an earlier checkpoint. Keep
    // the shared ancestors, not the abandoned replies from the other branch.
    if (
      event.kind === 'user' &&
      event.text &&
      event.parentId &&
      event.messageId &&
      !ids.has(event.id)
    ) {
      const parentIndex = messageEnds.get(event.parentId) ?? -1
      if (
        parentIndex >= 0 &&
        events
          .slice(parentIndex + 1)
          .some((item) => item.messageId && item.messageId !== event.messageId)
      ) {
        const pending = events.slice(parentIndex + 1).filter(isLocalUserEvent)
        events.splice(parentIndex + 1, events.length, ...pending)
        ids.clear()
        messageEnds.clear()
        remoteEchoes.clear()
        localEchoes.clear()
        events.forEach((item, index) => {
          ids.set(item.id, index)
          if (item.messageId) messageEnds.set(item.messageId, index)
          indexEcho(item, index)
        })
      }
    }
    const existingIndex = ids.get(event.id) ?? -1
    if (existingIndex >= 0) {
      const existing = events[existingIndex]!
      replace(existingIndex, {
        ...event,
        renderId: existing.renderId,
        turnStartedAt: existing.turnStartedAt ?? event.turnStartedAt,
        stopRequestedAt: existing.stopRequestedAt,
        turnStoppedAt: existing.turnStoppedAt,
        localDelivery: event.localDelivery ?? existing.localDelivery,
        receivedAt: existing.text === event.text ? existing.receivedAt : Date.now()
      })
      return
    }

    if (
      event.kind === 'user' &&
      event.text &&
      !(isLocalUserEvent(event) && event.turnStartedAt !== undefined)
    ) {
      const isLocal = isLocalUserEvent(event)
      const matches = (isLocal ? remoteEchoes : localEchoes).get(normalizedUserText(event.text))
      let echoIndex = -1
      if (matches) for (const index of matches) echoIndex = Math.max(echoIndex, index)
      if (echoIndex >= 0) {
        // A prompt can arrive through the watcher before or after its optimistic echo.
        // In either order, retain the transcript event as the single source of truth.
        if (isLocal) return
        replace(echoIndex, {
          ...event,
          renderId: events[echoIndex]!.renderId ?? events[echoIndex]!.id,
          turnStartedAt: events[echoIndex]!.turnStartedAt,
          stopRequestedAt: events[echoIndex]!.stopRequestedAt,
          turnStoppedAt: events[echoIndex]!.turnStoppedAt,
          localDelivery: 'sent',
          receivedAt: Date.now()
        })
        return
      }
    }
    ids.set(event.id, events.length)
    if (event.messageId) messageEnds.set(event.messageId, events.length)
    indexEcho(event, events.length)
    events.push({ ...event, receivedAt: event.receivedAt ?? Date.now() })
  }
  return { events, add }
}

function mergeTimelineEvent(previous: TimelineEvent[], event: TimelineEvent): TimelineEvent[] {
  const batch = timelineBatch(previous)
  batch.add(event)
  return batch.events
}

type DeliveryState =
  'sending' | 'sent' | 'generating' | 'finished' | 'failed' | 'response-failed' | 'stopped'

function responseDelivery(
  events: TimelineEvent[] = [],
  generating = false
): DeliveryState | undefined {
  const index = events.findLastIndex((event) => event.kind === 'user' && !!event.text)
  const prompt = events[index]
  if (!prompt || prompt.turnStartedAt === undefined) return undefined
  if (isLocalUserEvent(prompt) && prompt.localDelivery === 'failed') return undefined
  const turn = { id: prompt.id, prompt, events: events.slice(index + 1) }
  const result = presentTurn(turn, generating)
  return result.completed
    ? 'finished'
    : result.stopped
      ? 'stopped'
      : result.failed
        ? turn.prompt.localDelivery === 'failed'
          ? 'failed'
          : 'response-failed'
        : !isLocalUserEvent(prompt)
          ? generating
            ? 'generating'
            : 'sent'
          : undefined
}

interface ComposerFeedback {
  kind: 'info' | 'error'
  message: string
  promptId?: string
}

function reconcileFeedback(
  feedback: ComposerFeedback | undefined,
  events: TimelineEvent[]
): ComposerFeedback | undefined {
  return feedback?.promptId &&
    events.some((event) => event.renderId === feedback.promptId && !isLocalUserEvent(event))
    ? { kind: 'info', message: '' }
    : feedback
}

interface Toast {
  id: number
  level: 'info' | 'warning' | 'error'
  title: string
  body: string
}

interface AppState {
  nativeCommands: Record<string, string>
  setNativeCommand: (target: SessionTarget, command?: string) => void
  settings?: AppSettings
  sessions: RemoteSession[]
  sessionsByProfile: Record<string, RemoteSession[]>
  selected?: SessionTarget
  selectedByProfile: Record<string, string>
  statuses: Record<string, SessionStatus>
  transcriptStatuses: Record<string, TranscriptStatus>
  setTranscriptStatus: (target: SessionTarget, status: TranscriptStatus) => void
  claudeModes: Record<string, ClaudePermissionMode>
  timelines: Record<string, TimelineEvent[]>
  terminalBuffers: Record<string, string>
  terminalOpen: boolean
  workspaceMode: WorkspaceMode
  rightPanel: 'files' | 'terminal'
  rightPanelOpen: boolean
  setRightPanelOpen: (open: boolean) => void
  setRightPanel: (panel: 'files' | 'terminal') => void
  directControl: boolean
  busy: boolean
  composerBusy: Record<string, { sending?: boolean; uploading?: boolean }>
  composerFeedback: Record<string, ComposerFeedback | undefined>
  delivery: Record<string, DeliveryState>
  setDelivery: (target: SessionTarget, value: 'sending' | 'sent' | 'failed') => void
  updatePromptDelivery: (
    target: SessionTarget,
    id: string,
    value: 'sent' | 'failed',
    error?: string
  ) => void
  requestTurnStop: (target: SessionTarget, requested: boolean) => void
  uploadProgress: Record<string, UploadProgress>
  setUploadProgress: (target: SessionTarget, progress: UploadProgress) => void
  setComposerBusy: (
    target: SessionTarget,
    operation: 'sending' | 'uploading',
    value: boolean
  ) => void
  setComposerFeedback: (target: SessionTarget, feedback: ComposerFeedback) => void
  dismissComposerFeedback: (target: SessionTarget) => void
  toast?: Toast
  setSettings: (settings: AppSettings) => void
  setSessions: (sessions: RemoteSession[], profileId?: string) => void
  select: (target: SessionTarget) => void
  setStatus: (status: SessionStatus) => void
  setClaudeMode: (target: SessionTarget, mode: ClaudePermissionMode) => void
  addTimelineEvent: (target: SessionTarget, event: TimelineEvent) => void
  addTimelineEvents: (entries: { target: SessionTarget; event: TimelineEvent }[]) => void
  resetTimeline: (target: SessionTarget) => void
  clearSessionData: (target: SessionTarget) => void
  appendTerminalData: (target: SessionTarget, data: string) => void
  setTerminalOpen: (open: boolean) => void
  setWorkspaceMode: (mode: WorkspaceMode) => void
  setDirectControl: (enabled: boolean) => void
  setBusy: (busy: boolean) => void
  showToast: (toast: Omit<Toast, 'id'>) => void
  clearToast: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sessions: [],
  sessionsByProfile: {},
  selectedByProfile: {},
  statuses: {},
  transcriptStatuses: {},
  setTranscriptStatus: (target, status) =>
    set((state) => {
      const key = targetKey(target)
      const previous = state.transcriptStatuses[key]
      if (
        previous?.state === status.state &&
        previous.attempt === status.attempt &&
        previous.reason === status.reason
      )
        return state
      return { transcriptStatuses: { ...state.transcriptStatuses, [key]: status } }
    }),
  claudeModes: {},
  timelines: {},
  nativeCommands: {},
  setNativeCommand: (target, command) =>
    set((state) => {
      const nativeCommands = { ...state.nativeCommands }
      if (command) nativeCommands[targetKey(target)] = command
      else delete nativeCommands[targetKey(target)]
      return { nativeCommands }
    }),
  terminalBuffers: {},
  terminalOpen: initialWorkspaceMode() !== 'conversation',
  workspaceMode: initialWorkspaceMode(),
  rightPanel: 'terminal',
  rightPanelOpen: initialWorkspaceMode() === 'split',
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  setRightPanel: (rightPanel) => set({ rightPanel, rightPanelOpen: true }),
  directControl: false,
  busy: false,
  composerBusy: {},
  composerFeedback: {},
  delivery: {},
  requestTurnStop: (target, requested) =>
    set((state) => {
      const key = targetKey(target)
      const events = state.timelines[key] ?? []
      const prompt = events.filter((event) => event.kind === 'user' && event.text).at(-1)
      if (!prompt?.turnStartedAt || responseDelivery(events, state.statuses[key]?.generating))
        return state
      return {
        timelines: {
          ...state.timelines,
          [key]: events.map((event) =>
            event === prompt
              ? { ...event, stopRequestedAt: requested ? Date.now() : undefined }
              : event
          )
        }
      }
    }),
  updatePromptDelivery: (target, id, value, error) =>
    set((state) => {
      const key = targetKey(target)
      return {
        timelines: {
          ...state.timelines,
          [key]: (state.timelines[key] ?? []).map((event) =>
            event.id === id || event.renderId === id
              ? {
                  ...event,
                  localDelivery: isLocalUserEvent(event) ? value : 'sent',
                  sendError: isLocalUserEvent(event) ? error : undefined,
                  receivedAt:
                    value === 'failed' && isLocalUserEvent(event) ? Date.now() : event.receivedAt
                }
              : event
          )
        }
      }
    }),
  setDelivery: (target, value) =>
    set((state) => ({
      delivery: {
        ...state.delivery,
        [targetKey(target)]:
          (value === 'sending'
            ? undefined
            : responseDelivery(
                state.timelines[targetKey(target)],
                state.statuses[targetKey(target)]?.generating
              )) ??
          (value === 'sent' && state.statuses[targetKey(target)]?.generating ? 'generating' : value)
      }
    })),
  uploadProgress: {},
  setUploadProgress: (target, progress) =>
    set((state) => ({
      uploadProgress: { ...state.uploadProgress, [targetKey(target)]: progress }
    })),
  setComposerBusy: (target, operation, value) =>
    set((state) => ({
      composerBusy: {
        ...state.composerBusy,
        [targetKey(target)]: { ...state.composerBusy[targetKey(target)], [operation]: value }
      }
    })),
  setComposerFeedback: (target, feedback) =>
    set((state) => ({
      composerFeedback: { ...state.composerFeedback, [targetKey(target)]: feedback }
    })),
  dismissComposerFeedback: (target) =>
    set((state) => {
      const key = targetKey(target)
      const delivery = { ...state.delivery }
      if (state.composerFeedback[key]?.promptId && delivery[key] === 'failed') delete delivery[key]
      return { delivery, composerFeedback: { ...state.composerFeedback, [key]: undefined } }
    }),
  setSettings: (settings) =>
    set((state) => {
      const changedProfiles = new Set(
        (state.settings?.profiles ?? [])
          .filter((old) => {
            const next = settings.profiles.find((profile) => profile.id === old.id)
            return !next || connectionIdentity(old) !== connectionIdentity(next)
          })
          .map((profile) => profile.id)
      )
      const retain = <T>(values: Record<string, T>): Record<string, T> =>
        Object.fromEntries(
          Object.entries(values).filter(([key]) => !changedProfiles.has(key.split(':')[0]!))
        )
      const selectedByProfile = Object.fromEntries(
        Object.entries(state.selectedByProfile).filter(([id]) => !changedProfiles.has(id))
      )
      const profile = settings.profiles.find((item) => item.id === settings.currentProfileId)
      const switchTarget =
        state.selected?.profileId !== settings.currentProfileId ||
        changedProfiles.has(settings.currentProfileId)
      return {
        settings,
        selectedByProfile,
        sessionsByProfile: Object.fromEntries(
          Object.entries(state.sessionsByProfile).filter(([id]) => !changedProfiles.has(id))
        ),
        ...(changedProfiles.size
          ? {
              statuses: retain(state.statuses),
              transcriptStatuses: retain(state.transcriptStatuses),
              claudeModes: retain(state.claudeModes),
              timelines: retain(state.timelines),
              terminalBuffers: retain(state.terminalBuffers),
              composerBusy: retain(state.composerBusy),
              uploadProgress: retain(state.uploadProgress),
              composerFeedback: retain(state.composerFeedback),
              delivery: retain(state.delivery)
            }
          : {}),
        ...(!profile
          ? { sessions: [], selected: undefined, directControl: false }
          : switchTarget
            ? {
                sessions: changedProfiles.has(profile.id)
                  ? []
                  : (state.sessionsByProfile[profile.id] ?? []),
                selected: {
                  profileId: profile.id,
                  sessionName: selectedByProfile[profile.id] ?? profile.defaultSession
                },
                directControl: false
              }
            : {})
      }
    }),
  setSessions: (sessions, profileId) =>
    set((state) => {
      const id = profileId ?? state.settings?.currentProfileId
      return {
        ...(id ? { sessionsByProfile: { ...state.sessionsByProfile, [id]: sessions } } : {}),
        ...(!id || id === state.settings?.currentProfileId ? { sessions } : {})
      }
    }),
  select: (selected) =>
    set((state) => ({
      selected,
      selectedByProfile: { ...state.selectedByProfile, [selected.profileId]: selected.sessionName },
      directControl: false
    })),
  setStatus: (status) =>
    set((state) => {
      const key = targetKey(status)
      const ended =
        state.statuses[key]?.generating &&
        !status.generating &&
        status.state === 'attached' &&
        status.promptState === 'ready'
      const observed = responseDelivery(state.timelines[key], status.generating)
      const tracking =
        state.timelines[key]?.filter((event) => event.kind === 'user' && event.text).at(-1)
          ?.turnStartedAt !== undefined
      const prompt = state.timelines[key]
        ?.filter((event) => event.kind === 'user' && event.text)
        .at(-1)
      const stopped =
        !observed &&
        prompt?.stopRequestedAt &&
        !prompt.turnStoppedAt &&
        status.state === 'attached' &&
        status.promptState === 'ready' &&
        !status.generating
      return {
        ...(stopped
          ? {
              timelines: {
                ...state.timelines,
                [key]: state.timelines[key]!.map((event) =>
                  event === prompt ? { ...event, turnStoppedAt: Date.now() } : event
                )
              }
            }
          : {}),
        statuses: { ...state.statuses, [key]: status },
        delivery: stopped
          ? { ...state.delivery, [key]: 'stopped' }
          : observed
            ? { ...state.delivery, [key]: observed }
            : status.generating
              ? { ...state.delivery, [key]: 'generating' }
              : ended && !tracking
                ? { ...state.delivery, [key]: 'finished' }
                : ended && tracking
                  ? { ...state.delivery, [key]: 'sent' }
                  : state.delivery
      }
    }),
  setClaudeMode: (target, mode) =>
    set((state) => ({ claudeModes: { ...state.claudeModes, [targetKey(target)]: mode } })),
  addTimelineEvent: (target, event) =>
    set((state) => {
      const key = targetKey(target)
      const events = mergeTimelineEvent(state.timelines[key] ?? [], event)
      const observed = responseDelivery(events, state.statuses[key]?.generating)
      return {
        timelines: {
          ...state.timelines,
          [key]: events
        },
        composerFeedback: {
          ...state.composerFeedback,
          [key]: reconcileFeedback(state.composerFeedback[key], events)
        },
        delivery: observed ? { ...state.delivery, [key]: observed } : state.delivery
      }
    }),
  addTimelineEvents: (entries) =>
    set((state) => {
      const timelines = { ...state.timelines }
      const claudeModes = { ...state.claudeModes }
      const delivery = { ...state.delivery }
      const composerFeedback = { ...state.composerFeedback }
      const batches = new Map<string, ReturnType<typeof timelineBatch>>()
      for (const { target, event } of entries) {
        if (state.settings && !state.settings.profiles.some((p) => p.id === target.profileId))
          continue
        const key = targetKey(target)
        let batch = batches.get(key)
        if (!batch) {
          batch = timelineBatch(timelines[key] ?? [])
          batches.set(key, batch)
        }
        batch.add(event)
        if (event.permissionMode) claudeModes[key] = event.permissionMode
      }
      for (const [key, batch] of batches) {
        timelines[key] = batch.events
        const observed = responseDelivery(batch.events, state.statuses[key]?.generating)
        if (observed) delivery[key] = observed
        composerFeedback[key] = reconcileFeedback(composerFeedback[key], batch.events)
      }
      return { timelines, claudeModes, delivery, composerFeedback }
    }),
  resetTimeline: (target) =>
    set((state) => ({ timelines: { ...state.timelines, [targetKey(target)]: [] } })),
  clearSessionData: (target) =>
    set((state) => {
      const key = targetKey(target)
      const claudeModes = { ...state.claudeModes }
      const timelines = { ...state.timelines }
      const terminalBuffers = { ...state.terminalBuffers }
      const statuses = { ...state.statuses }
      const transcriptStatuses = { ...state.transcriptStatuses }
      const composerFeedback = { ...state.composerFeedback }
      const delivery = { ...state.delivery }
      const uploadProgress = { ...state.uploadProgress }
      delete claudeModes[key]
      delete timelines[key]
      delete terminalBuffers[key]
      delete statuses[key]
      delete transcriptStatuses[key]
      delete composerFeedback[key]
      delete delivery[key]
      delete uploadProgress[key]
      return {
        claudeModes,
        timelines,
        terminalBuffers,
        statuses,
        transcriptStatuses,
        composerFeedback,
        uploadProgress,
        delivery
      }
    }),
  appendTerminalData: (target, data) =>
    set((state) => {
      const key = targetKey(target)
      const combined = `${state.terminalBuffers[key] ?? ''}${data}`
      return {
        terminalBuffers: {
          ...state.terminalBuffers,
          [key]: combined.length > 2_000_000 ? combined.slice(-2_000_000) : combined
        }
      }
    }),
  setTerminalOpen: (terminalOpen) => {
    const workspaceMode = terminalOpen
      ? localStorage.getItem('clb:ui:terminal-position') === 'bottom'
        ? 'terminal'
        : 'split'
      : 'conversation'
    localStorage.setItem(TERMINAL_OPEN_KEY, String(terminalOpen))
    localStorage.setItem(WORKSPACE_MODE_KEY, workspaceMode)
    set({
      terminalOpen,
      workspaceMode,
      ...(terminalOpen && workspaceMode === 'split'
        ? { rightPanel: 'terminal' as const, rightPanelOpen: true }
        : {})
    })
  },
  setWorkspaceMode: (workspaceMode) => {
    const terminalOpen = workspaceMode !== 'conversation'
    if (terminalOpen)
      localStorage.setItem(
        'clb:ui:terminal-position',
        workspaceMode === 'terminal' ? 'bottom' : 'right'
      )
    localStorage.setItem(TERMINAL_OPEN_KEY, String(terminalOpen))
    localStorage.setItem(WORKSPACE_MODE_KEY, workspaceMode)
    set({
      terminalOpen,
      workspaceMode,
      ...(workspaceMode === 'split'
        ? { rightPanel: 'terminal' as const, rightPanelOpen: true }
        : {})
    })
  },
  setDirectControl: (directControl) => set({ directControl }),
  setBusy: (busy) => set({ busy }),
  showToast: (toast) => set({ toast: { id: Date.now(), ...toast } }),
  clearToast: () => set({ toast: undefined })
}))
