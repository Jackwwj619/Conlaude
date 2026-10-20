import { z } from 'zod'
import { InterfaceFontSchema, TerminalFontSchema } from './font-presets'

export const SESSION_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
export const PROFILE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
export const HOST_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/

export const SshAuthModeSchema = z.enum(['key', 'agent', 'password'])
export type SshAuthMode = z.infer<typeof SshAuthModeSchema>

export const ThemeModeSchema = z.enum(['light', 'dark', 'system'])
export type ThemeMode = z.infer<typeof ThemeModeSchema>

export const AppLanguageSchema = z.enum(['zh-CN', 'en-US'])
export type AppLanguage = z.infer<typeof AppLanguageSchema>

export const MAX_PROFILES = 20

export const ProfileSchema = z.object({
  id: z.string().regex(PROFILE_ID_PATTERN),
  label: z.string().min(1).max(80),
  // 没有 sshHost 时使用这些显式连接参数。
  host: z.string().regex(HOST_PATTERN),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().min(1).max(128).optional(),
  authMode: SshAuthModeSchema.default('key'),
  privateKeyPath: z.string().max(4096).optional(),
  proxyJump: z.string().max(255).optional(),
  // 标准 OpenSSH Host 别名。提供时由 ~/.ssh/config 完整解析连接参数。
  sshHost: z
    .string()
    .regex(/^[A-Za-z0-9_.@-]{1,255}$/)
    .optional(),
  defaultSession: z.string().regex(SESSION_NAME_PATTERN),
  defaultCwd: z.string().min(1).max(4096),
  claudePath: z.string().min(1).max(4096)
})

export type Profile = z.infer<typeof ProfileSchema>

export interface SshConfigEntry {
  host: string
  hostName?: string
  user?: string
  port?: number
  identityFile?: string
  identitiesOnly?: boolean
  proxyJump?: string
}

export interface SshConfigFile {
  path: string
  content: string
  entries: SshConfigEntry[]
}

export const SshConfigContentSchema = z
  .string()
  .max(1024 * 1024)
  .refine((value) => !value.includes('\0'), 'NUL is not allowed in SSH config')

export interface SshConfigImportResult {
  imported: number
  profiles: Array<Pick<Profile, 'id' | 'label'> & { host: string }>
  skipped: string[]
}

export const TerminalSettingsSchema = z.object({
  font: TerminalFontSchema,
  fontSize: z.number().int().min(10).max(28),
  scrollback: z.number().int().min(1000).max(100000),
  lineHeight: z.number().min(1).max(2),
  cursorStyle: z.enum(['block', 'bar', 'underline']),
  cursorBlink: z.boolean()
})

export const ComposerSendShortcutSchema = z.enum(['Ctrl+Enter', 'Enter'])
export type ComposerSendShortcut = z.infer<typeof ComposerSendShortcutSchema>

export const ComposerSettingsSchema = z.object({
  sendShortcut: ComposerSendShortcutSchema,
  maxCharacters: z.number().int().min(1000).max(1000000),
  fontSize: z.number().int().min(12).max(24),
  lineWrapping: z.boolean(),
  historyLimit: z.number().int().min(0).max(500),
  historyNavigation: z.enum(['arrows', 'alt-arrows', 'off'])
})

export const ConversationSettingsSchema = z.object({
  widthMode: z.enum(['full', 'limited']).default('limited'),
  maxWidth: z.number().int().min(560).max(1600).default(820),
  fontSize: z.number().int().min(12).max(24),
  lineHeight: z.number().min(1.3).max(2.2),
  showTimestamps: z.boolean(),
  expandActivity: z.boolean(),
  autoScroll: z.boolean()
})

export const AppearanceSettingsSchema = z.object({
  density: z.enum(['compact', 'comfortable']),
  fontSize: z.number().int().min(11).max(16),
  accent: z.enum(['graphite', 'blue', 'teal', 'violet']),
  cornerRadius: z.number().int().min(0).max(16),
  motion: z.enum(['system', 'reduced']),
  sidebarFontSize: z.number().int().min(11).max(16),
  showServerAddress: z.boolean(),
  showSessionCount: z.boolean(),
  headerServer: z.enum(['alias', 'label', 'hidden']),
  showConnectionStatus: z.boolean(),
  showViewLabels: z.boolean(),
  contentPadding: z.number().int().min(12).max(48),
  messageSpacing: z.number().int().min(12).max(48),
  composerMaxHeight: z.number().int().min(100).max(360)
})

export const AppSettingsSchema = z
  .object({
    schemaVersion: z.literal(10),
    appearance: AppearanceSettingsSchema,
    profiles: z.array(ProfileSchema).max(MAX_PROFILES),
    currentProfileId: z.string().regex(PROFILE_ID_PATTERN).or(z.literal('')),
    theme: ThemeModeSchema,
    interfaceFont: InterfaceFontSchema,
    replyFont: InterfaceFontSchema,
    code: z.object({
      font: TerminalFontSchema,
      fontSize: z.number().int().min(10).max(28),
      lineHeight: z.number().min(1).max(2.2)
    }),
    language: AppLanguageSchema,
    terminal: TerminalSettingsSchema,
    composer: ComposerSettingsSchema,
    conversation: ConversationSettingsSchema,
    notifications: z.boolean(),
    startMinimizedToTray: z.boolean(),
    closeToTray: z.boolean(),
    confirmExternalLinks: z.boolean()
  })
  .refine(
    (settings) =>
      settings.profiles.length > 0
        ? settings.currentProfileId !== ''
        : settings.currentProfileId === '',
    { message: 'Select a server only when profiles exist', path: ['currentProfileId'] }
  )

export type AppSettings = z.infer<typeof AppSettingsSchema>

export const AttachSessionRequestSchema = z.object({
  profileId: z.string().regex(PROFILE_ID_PATTERN),
  sessionName: z.string().regex(SESSION_NAME_PATTERN),
  readOnly: z.boolean().default(false),
  detachOtherClients: z.boolean().default(false)
})

export type AttachSessionRequest = z.input<typeof AttachSessionRequestSchema>

export const CreateSessionRequestSchema = z.object({
  profileId: z.string().regex(PROFILE_ID_PATTERN),
  sessionName: z.string().regex(SESSION_NAME_PATTERN),
  cwd: z.string().min(1).max(4096)
})

export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

export const SessionTargetSchema = z.object({
  profileId: z.string().regex(PROFILE_ID_PATTERN),
  sessionName: z.string().regex(SESSION_NAME_PATTERN)
})

export type SessionTarget = z.infer<typeof SessionTargetSchema>

export const RenameSessionRequestSchema = SessionTargetSchema.extend({
  newName: z.string().regex(SESSION_NAME_PATTERN)
})

export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>

export const SendPromptRequestSchema = SessionTargetSchema.extend({
  requestId: z.string().uuid(),
  text: z.string().min(1).max(1000000)
})

export type SendPromptRequest = z.infer<typeof SendPromptRequestSchema>

export const ResizeTerminalRequestSchema = SessionTargetSchema.extend({
  cols: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(300)
})

export type ResizeTerminalRequest = z.infer<typeof ResizeTerminalRequestSchema>

export const TerminalControlSchema = z.enum([
  'enter',
  'escape',
  'tab',
  'shiftTab',
  'arrowUp',
  'arrowDown',
  'arrowLeft',
  'arrowRight',
  'ctrlC',
  'ctrlO',
  'ctrlR',
  'backspace',
  'space',
  'yes',
  'no',
  'one',
  'two',
  'three'
])

export type TerminalControl = z.infer<typeof TerminalControlSchema>

export const WriteControlRequestSchema = SessionTargetSchema.extend({
  control: TerminalControlSchema
})

export type WriteControlRequest = z.infer<typeof WriteControlRequestSchema>

export const WriteTerminalInputRequestSchema = SessionTargetSchema.extend({
  data: z
    .string()
    .min(1)
    .max(8192)
    .refine((value) => !value.includes('\0'), 'NUL is not allowed')
})

export type WriteTerminalInputRequest = z.infer<typeof WriteTerminalInputRequestSchema>

export type ConnectionState =
  'idle' | 'checking' | 'connecting' | 'attached' | 'reconnecting' | 'detached' | 'failed'

export interface RemoteSession {
  name: string
  windows: number
  attachedClients: number
  createdAt?: number
  currentCommand?: string
  currentPath?: string
  paneTty?: string
  isClaude?: boolean
}

export interface SessionStatus {
  profileId: string
  sessionName: string
  state: ConnectionState
  readOnly: boolean
  attempt: number
  message?: string
  changedAt: number
  promptState?: import('./claude-input-state').ClaudeInputState
  promptMessage?: string
  /** Observed on the current tmux screen, never inferred from historical JSONL. */
  generating?: boolean
  permissionMode?: ClaudePermissionMode
}

export interface TranscriptStatus {
  state: 'connecting' | 'live' | 'reconnecting' | 'unavailable'
  attempt: number
  reason?: 'connection' | 'association'
}

export type TimelineEventKind =
  'user' | 'assistant' | 'status' | 'tool-use' | 'tool-result' | 'system' | 'error' | 'unknown'

export const ClaudePermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'auto'
])
export type ClaudePermissionMode = z.infer<typeof ClaudePermissionModeSchema>

export function isClaudePermissionMode(value: unknown): value is ClaudePermissionMode {
  return ClaudePermissionModeSchema.safeParse(value).success
}

export interface TimelineEvent {
  id: string
  /** Model reported by an assistant response, not the next request's selected model. */
  model?: string
  /** Local clock: send initiation and receipt, never mixed with remote timestamps. */
  turnStartedAt?: number
  stopRequestedAt?: number
  turnStoppedAt?: number
  receivedAt?: number
  localDelivery?: 'sending' | 'sent' | 'failed'
  sendError?: string
  responseError?: {
    code?: string
    retrying: boolean
    retryAfterMs?: number
    attempt?: number
  }
  renderId?: string
  messageId?: string
  parentId?: string
  toolCallId?: string
  toolResultId?: string
  sessionId?: string
  kind: TimelineEventKind
  /** Explicit source of process text; metadata-only status records remain available to the store. */
  activityType?: 'thinking' | 'progress'
  // Assistant text that accompanies a tool call is progress, not the final reply for a turn.
  // Older or locally-created assistant events omit this and remain visible by default.
  isFinal?: boolean
  timestamp?: string
  text?: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  isError?: boolean
  // Claude Code writes this into its session JSONL. It is the source for the UI mode badge.
  permissionMode?: ClaudePermissionMode
  rawType?: string
  offset?: number
}

export interface DiagnosticCheck {
  id: string
  label: string
  status: 'ok' | 'warning' | 'error' | 'skipped'
  detail: string
  code?: string
}

export interface DiagnosticReport {
  generatedAt: string
  checks: DiagnosticCheck[]
  complete?: boolean
  activeCheck?: string
  elapsedMs?: number
}

export interface UploadResult {
  canceled: boolean
  localPath?: string
  remotePath?: string
  bytes?: number
}

export interface UploadProgress {
  filename: string
  bytes: number
  startedAt: number
  stage: 'preparing' | 'transferring' | 'resolving' | 'complete' | 'failed'
}

export type AppAction = 'new-chat' | 'servers' | 'settings' | 'diagnostics'

export type BridgeEvent =
  | { type: 'app-action'; action: AppAction }
  | { type: 'transcript-status'; target: SessionTarget; status: TranscriptStatus }
  | { type: 'upload-progress'; target: SessionTarget; progress: UploadProgress }
  | { type: 'diagnostics-progress'; profileId: string; report: DiagnosticReport }
  | { type: 'focus-session'; target: SessionTarget }
  | { type: 'pty-data'; target: SessionTarget; data: string }
  | { type: 'session-status'; status: SessionStatus }
  | { type: 'timeline-event'; target: SessionTarget; event: TimelineEvent }
  | { type: 'timeline-reset'; target: SessionTarget }
  | { type: 'notification'; level: 'info' | 'warning' | 'error'; title: string; body: string }

export interface ClaudeBridgeApi {
  files: import('./remote-files').RemoteFilesApi
  settings: {
    get: () => Promise<AppSettings>
    update: (settings: AppSettings) => Promise<AppSettings>
  }
  profiles: {
    remove: (profileId: string) => Promise<AppSettings>
    test: (profile: Profile) => Promise<{ ok: boolean; message: string }>
    importSshConfig: () => Promise<SshConfigImportResult>
    getSshConfig: () => Promise<SshConfigFile>
    saveSshConfig: (content: string) => Promise<SshConfigFile>
    revealSshConfig: () => Promise<void>
  }
  sessions: {
    list: (profileId: string) => Promise<RemoteSession[]>
    attach: (request: AttachSessionRequest) => Promise<SessionStatus>
    detach: (target: SessionTarget) => Promise<void>
    create: (request: CreateSessionRequest) => Promise<RemoteSession>
    rename: (request: RenameSessionRequest) => Promise<RemoteSession>
    terminate: (target: SessionTarget, confirmation: string) => Promise<void>
  }
  prompts: {
    command: (request: SessionTarget & { text: string }) => Promise<void>
    finishCommand: (target: SessionTarget) => Promise<void>
    send: (request: SendPromptRequest) => Promise<{ accepted: true; requestId: string }>
    interrupt: (target: SessionTarget) => Promise<void>
  }
  terminal: {
    resize: (request: ResizeTerminalRequest) => Promise<void>
    writeControl: (request: WriteControlRequest) => Promise<void>
    writeInput: (request: WriteTerminalInputRequest) => Promise<void>
  }
  uploads: {
    image: (target: SessionTarget, dataUrl: string) => Promise<UploadResult>
    chooseAndUpload: (target: SessionTarget) => Promise<UploadResult>
  }
  helper: {
    status: (profileId: string) => Promise<{ installed: boolean; version?: string; detail: string }>
    install: (profileId: string) => Promise<{ version: string; sha256: string }>
  }
  diagnostics: {
    run: (profileId: string) => Promise<DiagnosticReport>
    export: (profileId: string) => Promise<{ canceled: boolean; path?: string }>
  }
  app: {
    listFonts: (refresh?: boolean) => Promise<string[]>
    openExternal: (url: string) => Promise<boolean>
    getVersion: () => Promise<string>
  }
  events: {
    subscribe: (handler: (event: BridgeEvent) => void) => () => void
  }
}
