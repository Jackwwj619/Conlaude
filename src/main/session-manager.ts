import { randomUUID } from 'node:crypto'
import { parseClaudeCommand, changesConversation } from '../shared/claude-commands'
import { encodePromptForTerminal } from '../shared/prompt'
import {
  classifyClaudeScreen,
  claudePermissionModeFromScreen,
  ClaudeGenerationObserver
} from '../shared/claude-input-state'
import type {
  AttachSessionRequest,
  CreateSessionRequest,
  ClaudePermissionMode,
  Profile,
  RemoteSession,
  RenameSessionRequest,
  SessionStatus,
  SessionTarget
} from '../shared/contracts'
import {
  AttachSessionRequestSchema,
  CreateSessionRequestSchema,
  RenameSessionRequestSchema,
  SessionTargetSchema
} from '../shared/contracts'
import { logger } from './logger'
import { connectionIdentity } from '../shared/profile-identity'
import { translate } from '../shared/i18n'
import { TERMINAL_CONTROL_SEQUENCES } from '../shared/terminal-controls'
import { PtyManager, sessionKey, type PtyExit } from './pty-manager'
import { SshClient, shellQuote } from './ssh-client'
import type { ConfigStore } from './config-store'
import type { TranscriptWatcher } from './transcript-watcher'

interface ActiveSession {
  profile: Profile
  request: Required<AttachSessionRequest>
  status: SessionStatus
  manualDetach: boolean
  reconnectTimer?: ReturnType<typeof setTimeout>
  inputTimer?: ReturnType<typeof setTimeout>
  inputRevision: number
  generation: ClaudeGenerationObserver
  sending?: boolean
  interrupting?: boolean
  interruptRequested?: boolean
  outputChecking?: boolean
  cwd?: string
  isClaude?: boolean
  nativeCommand?: string
  lastScreen?: string
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]

export class SessionManager {
  private readonly active = new Map<string, ActiveSession>()

  constructor(
    private readonly config: ConfigStore,
    private readonly ssh: SshClient,
    private readonly ptys: PtyManager,
    private readonly transcripts: TranscriptWatcher,
    private readonly emitStatus: (status: SessionStatus) => void
  ) {}

  async list(profileId: string): Promise<RemoteSession[]> {
    const profile = this.config.profile(profileId)
    const helper = await this.ssh.runHelper(profile, ['list-sessions'])
    if (helper.exitCode === 0) {
      try {
        const parsed = JSON.parse(helper.stdout.trim()) as { sessions?: RemoteSession[] }
        if (Array.isArray(parsed.sessions)) return parsed.sessions
      } catch {
        logger.warn(`Helper session list was invalid for profile ${profile.id}`)
      }
    }

    const format =
      '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{pane_current_command}\t#{pane_current_path}\t#{pane_tty}'
    const fallback = await this.ssh.run(profile, `tmux list-panes -a -F ${shellQuote(format)}`)
    if (fallback.exitCode !== 0) {
      if (fallback.stderr.toLowerCase().includes('no server running')) return []
      throw new Error(fallback.stderr.trim() || 'Unable to list tmux sessions')
    }

    const sessions = new Map<string, RemoteSession>()
    for (const line of fallback.stdout.split(/\r?\n/)) {
      const [name, windows, attached, createdAt, currentCommand, currentPath, paneTty] =
        line.split('\t')
      if (!name || sessions.has(name)) continue
      sessions.set(name, {
        name,
        windows: Number(windows) || 0,
        attachedClients: Number(attached) || 0,
        createdAt: Number(createdAt) || undefined,
        currentCommand,
        currentPath,
        paneTty,
        isClaude: currentCommand?.toLowerCase().includes('claude') ?? false
      })
    }
    return [...sessions.values()]
  }

  async attach(input: AttachSessionRequest): Promise<SessionStatus> {
    const request = AttachSessionRequestSchema.parse(input)
    const normalized: Required<AttachSessionRequest> = {
      ...request,
      readOnly: request.readOnly ?? false,
      detachOtherClients: request.detachOtherClients ?? false
    }
    const target = { profileId: request.profileId, sessionName: request.sessionName }
    const key = sessionKey(target)
    const existing = this.active.get(key)
    if (existing?.status.state === 'attached' && this.ptys.has(target)) return existing.status
    if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer)
    if (existing?.inputTimer) clearTimeout(existing.inputTimer)

    const profile = this.config.profile(request.profileId)
    const session: ActiveSession = {
      profile: { ...profile },
      request: normalized,
      manualDetach: false,
      inputRevision: 0,
      generation: new ClaudeGenerationObserver(),
      nativeCommand: existing?.nativeCommand,
      status: this.makeStatus(
        target,
        'checking',
        normalized.readOnly,
        0,
        'Checking SSH and tmux session…'
      )
    }
    this.active.set(key, session)
    this.emitStatus(session.status)
    try {
      let inspected: RemoteSession | undefined
      const helperInspection = await this.ssh.runHelper(
        profile,
        ['inspect-session', '--name', target.sessionName],
        15000
      )
      if (helperInspection.exitCode === 0) {
        try {
          const response = JSON.parse(helperInspection.stdout.trim()) as {
            session?: RemoteSession
          }
          if (response.session?.name === target.sessionName) inspected = response.session
        } catch {
          logger.warn(`Helper session inspection was invalid for ${sessionKey(target)}`)
        }
      }

      if (!inspected) {
        const inspectFormat = '#{pane_current_command}\t#{pane_current_path}'
        const preflight = await this.ssh.run(
          profile,
          `tmux display-message -p -t ${shellQuote(`${target.sessionName}:0.0`)} ${shellQuote(inspectFormat)}`,
          15000
        )
        if (preflight.exitCode !== 0) {
          throw new Error(
            preflight.stderr.trim() ||
              helperInspection.stderr.trim() ||
              'tmux session is unavailable'
          )
        }
        const [currentCommand, currentPath] = preflight.stdout.trim().split('\t')
        inspected = {
          name: target.sessionName,
          windows: 1,
          attachedClients: 0,
          currentCommand,
          currentPath,
          isClaude: currentCommand?.toLowerCase().includes('claude') ?? false
        }
      }

      // A detach or a newer attach may have happened during the remote inspection.
      if (session.manualDetach || this.active.get(key) !== session) return session.status
      session.cwd = inspected.currentPath || profile.defaultCwd
      session.isClaude = inspected.isClaude ?? false
      session.status = this.makeStatus(
        target,
        'connecting',
        normalized.readOnly,
        0,
        'Opening terminal…'
      )
      this.emitStatus(session.status)
      this.openPty(profile, target, session)
      return session.status
    } catch (error) {
      if (session.manualDetach || this.active.get(key) !== session) return session.status
      session.status = this.makeStatus(
        target,
        'failed',
        normalized.readOnly,
        0,
        error instanceof Error ? error.message : 'Unable to inspect the remote session'
      )
      this.emitStatus(session.status)
      throw error
    }
  }

  private openPty(profile: Profile, target: SessionTarget, session: ActiveSession): void {
    session.generation = new ClaudeGenerationObserver()
    session.interruptRequested = false
    const flags = [
      session.request.detachOtherClients ? '-d' : '',
      session.request.readOnly ? '-r' : ''
    ]
      .filter(Boolean)
      .join(' ')
    const remoteCommand = `tmux attach-session ${flags} -t ${shellQuote(target.sessionName)}`
    try {
      this.ptys.spawn(target, this.ssh.sshPath, this.ssh.interactiveArgs(profile, remoteCommand))
      session.status = this.makeStatus(
        target,
        'attached',
        session.request.readOnly,
        session.status.attempt,
        session.isClaude
          ? 'Connected to persistent Claude tmux session'
          : 'Connected to tmux terminal (the pane is not running Claude)'
      )
      session.status.promptState = session.isClaude ? 'checking' : 'unavailable'
      session.status.promptMessage = translate(
        this.config.get().language,
        session.isClaude ? 'session.input.checking' : 'session.input.terminalOnly'
      )
      this.emitStatus(session.status)
      if (session.isClaude !== false && !session.nativeCommand)
        void this.transcripts.start(profile, target, session.cwd)
      if (session.isClaude) this.scheduleInputCheck(target, session)
    } catch (error) {
      logger.error(`Unable to open PTY for ${sessionKey(target)}`, error)
      this.scheduleReconnect(
        target,
        session,
        error instanceof Error ? error.message : 'Connection failed'
      )
    }
  }

  onPtyExit(event: PtyExit): void {
    const key = sessionKey(event.target)
    const session = this.active.get(key)
    if (!session) return
    if (session.inputTimer) clearTimeout(session.inputTimer)
    this.transcripts.stop(event.target)
    if (session.manualDetach) {
      session.status = this.makeStatus(
        event.target,
        'detached',
        session.request.readOnly,
        session.status.attempt,
        'Disconnected locally; tmux is still running'
      )
      this.emitStatus(session.status)
      return
    }
    this.scheduleReconnect(event.target, session, `SSH exited with code ${event.exitCode}`)
  }

  private scheduleReconnect(target: SessionTarget, session: ActiveSession, reason: string): void {
    const attempt = session.status.attempt + 1
    const delay =
      RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)] ?? 30000
    session.status = this.makeStatus(
      target,
      'reconnecting',
      session.request.readOnly,
      attempt,
      `${reason}. Retrying in ${Math.round(delay / 1000)}s…`
    )
    this.emitStatus(session.status)
    session.reconnectTimer = setTimeout(() => {
      session.reconnectTimer = undefined
      if (!session.manualDetach) void this.reconnect(target, session)
    }, delay)
  }

  private isCurrent(target: SessionTarget, session: ActiveSession): boolean {
    return !session.manualDetach && this.active.get(sessionKey(target)) === session
  }

  private async reconnect(target: SessionTarget, session: ActiveSession): Promise<void> {
    try {
      const result = await this.ssh.run(
        session.profile,
        "tmux list-sessions -F '#{session_name}'",
        15000
      )
      if (!this.isCurrent(target, session)) return
      const missing =
        (result.exitCode === 0 && !result.stdout.split(/\r?\n/).includes(target.sessionName)) ||
        (result.exitCode !== 255 && /no server running|no sessions/i.test(result.stderr))
      if (missing) {
        session.status = this.makeStatus(
          target,
          'failed',
          session.request.readOnly,
          session.status.attempt,
          translate(this.config.get().language, 'session.ended')
        )
        this.emitStatus(session.status)
        return
      }
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'SSH unavailable')
      this.openPty(session.profile, target, session)
    } catch (error) {
      if (this.isCurrent(target, session)) {
        this.scheduleReconnect(
          target,
          session,
          error instanceof Error ? error.message : 'SSH unavailable'
        )
      }
    }
  }

  refreshAfterOutput(target: SessionTarget): void {
    const session = this.active.get(sessionKey(target))
    if (
      session?.isClaude &&
      this.isAttached(target) &&
      !session.inputTimer &&
      !session.outputChecking
    )
      this.scheduleInputCheck(target, session, 800)
  }

  refreshAfterInput(target: SessionTarget, data: string): void {
    const session = this.active.get(sessionKey(target))
    if (!session?.isClaude || !this.isCurrent(target, session) || !this.isAttached(target)) return
    if (
      data.includes(TERMINAL_CONTROL_SEQUENCES.shiftTab) ||
      ['\r', '\n', '\x03', '\x1b'].some((control) => data.includes(control))
    ) {
      session.inputRevision += 1
      this.scheduleInputCheck(target, session, 150)
    }
  }

  private scheduleInputCheck(target: SessionTarget, session: ActiveSession, delay = 1500): void {
    if (session.inputTimer) clearTimeout(session.inputTimer)
    session.inputTimer = setTimeout(() => {
      session.inputTimer = undefined
      session.outputChecking = true
      void this.refreshInputState(target, session).finally(() => {
        session.outputChecking = false
      })
    }, delay)
  }

  private async refreshInputState(target: SessionTarget, session: ActiveSession): Promise<void> {
    if (!this.isCurrent(target, session) || !this.isAttached(target)) return
    const revision = session.inputRevision
    let state: SessionStatus['promptState'] = 'unavailable'
    let permissionMode: ClaudePermissionMode | undefined
    let screen: string | undefined
    try {
      const result = await this.ssh.run(
        session.profile,
        `tmux capture-pane -p -t ${shellQuote(`=${target.sessionName}:0.0`)}`,
        10000
      )
      if (result.exitCode === 0) {
        state = classifyClaudeScreen(result.stdout)
        screen = result.stdout
        if (state === 'ready') permissionMode = claudePermissionModeFromScreen(result.stdout)
      }
    } catch {
      // A failed inspection must never fall through to typing into an unknown screen.
    }
    if (
      !this.isCurrent(target, session) ||
      !this.isAttached(target) ||
      revision !== session.inputRevision
    )
      return
    session.lastScreen = screen
    const generating = screen !== undefined ? session.generation.observe(screen) : false
    const message =
      state === 'ready'
        ? undefined
        : translate(this.config.get().language, `session.input.${state}`)
    if (!generating && state === 'ready') session.interruptRequested = false
    if (
      session.status.promptState !== state ||
      session.status.promptMessage !== message ||
      session.status.generating !== generating ||
      (permissionMode !== undefined && session.status.permissionMode !== permissionMode)
    ) {
      session.status = {
        ...session.status,
        promptState: state,
        promptMessage: message,
        generating,
        permissionMode: permissionMode ?? session.status.permissionMode,
        changedAt: Date.now()
      }
      this.emitStatus(session.status)
    }
    if (state !== 'ready' || generating) this.scheduleInputCheck(target, session)
    else if (session.inputTimer) {
      clearTimeout(session.inputTimer)
      session.inputTimer = undefined
    }
  }

  async interruptPrompt(target: SessionTarget): Promise<void> {
    const session = this.active.get(sessionKey(target))
    if (!session || !this.isAttached(target)) throw new Error('Claude session is not connected')
    if (session.request.readOnly) throw new Error('This session is read-only')
    if (!session.isClaude || session.sending) throw new Error('Claude cannot be interrupted now')
    if (session.interrupting || session.interruptRequested) return
    session.interrupting = true
    try {
      const revision = session.inputRevision
      await this.refreshInputState(target, session)
      if (!this.isCurrent(target, session) || !this.isAttached(target))
        throw new Error('Claude session is not connected')
      if (revision !== session.inputRevision)
        throw new Error(translate(this.config.get().language, 'composer.stopFailed'))
      if (session.status.promptState === 'confirmation' || !session.status.generating) return
      if (session.status.promptState !== 'ready')
        throw new Error('Check the terminal before interrupting')
      this.ptys.write(target, TERMINAL_CONTROL_SEQUENCES.escape)
      session.interruptRequested = true
      this.refreshAfterInput(target, TERMINAL_CONTROL_SEQUENCES.escape)
    } finally {
      session.interrupting = false
    }
  }

  async sendPrompt(target: SessionTarget, sequence: string): Promise<void> {
    const session = this.active.get(sessionKey(target))
    if (!session || !this.isAttached(target)) throw new Error('Claude session is not connected')
    if (session.request.readOnly) throw new Error('This session is read-only')
    if (session.nativeCommand)
      throw new Error('Finish the native interaction before sending a message')
    if (session.sending) throw new Error('A message is already being sent')
    if (session.interrupting || session.interruptRequested)
      throw new Error(translate(this.config.get().language, 'composer.stopping'))
    if (!session.isClaude)
      throw new Error(translate(this.config.get().language, 'session.input.terminalOnly'))
    session.sending = true
    try {
      // Recheck on every send: a permission or trust dialog may have appeared
      // since attach. Never send Enter based solely on the SSH connection state.
      await this.refreshInputState(target, session)
      if (!this.isCurrent(target, session) || !this.isAttached(target)) {
        throw new Error('Claude session is not connected')
      }
      if (session.status.promptState !== 'ready') {
        throw new Error(session.status.promptMessage)
      }
      if (sequence.startsWith('\u001b[200~') && sequence.endsWith('\u001b[201~\r')) {
        // Claude processes pasted image paths asynchronously. Enter in the same
        // input chunk can be consumed before that work has populated the editor.
        const inputRegion = (screen: string): string =>
          screen.slice([...screen.matchAll(/(?:^|\n)\s*❯/gu)].at(-1)?.index ?? 0)
        const before = session.lastScreen ? inputRegion(session.lastScreen) : undefined
        const input = [...(before ?? '').matchAll(/(?:^|\n)\s*❯([^\n]*)/gu)].at(-1)?.[1]
        if (input === undefined || input.trim())
          throw new Error('Clear or submit the existing remote input in the terminal first')
        const revision = session.inputRevision
        this.ptys.write(target, sequence.slice(0, -1))
        let previous: string | undefined
        let settled = false
        for (let attempt = 0; attempt < 25; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 400))
          if (
            !this.isCurrent(target, session) ||
            !this.isAttached(target) ||
            session.interruptRequested ||
            revision !== session.inputRevision
          )
            throw new Error('Session changed while preparing the message')
          await this.refreshInputState(target, session)
          if (
            !this.isCurrent(target, session) ||
            !this.isAttached(target) ||
            revision !== session.inputRevision
          )
            throw new Error('Session changed while preparing the message')
          if (session.lastScreen && classifyClaudeScreen(session.lastScreen) === 'confirmation')
            throw new Error(session.status.promptMessage)
          const screen = session.lastScreen ? inputRegion(session.lastScreen) : undefined
          if (
            session.status.promptState === 'ready' &&
            screen &&
            screen !== before &&
            screen === previous
          ) {
            settled = true
            break
          }
          previous = screen
        }
        if (!settled)
          throw new Error('无法确认终端已接收粘贴内容，请检查终端中的草稿；尚未发送 Enter。')
        this.ptys.write(target, '\r')
      } else {
        this.ptys.write(target, sequence)
      }
    } finally {
      session.sending = false
    }
  }

  async runCommand(target: SessionTarget, text: string): Promise<void> {
    const command = parseClaudeCommand(text)
    if (
      !command ||
      text.length > 8000 ||
      Array.from(text).some((char) => {
        const code = char.charCodeAt(0)
        return (code < 32 && code !== 9) || code === 127
      })
    )
      throw new Error('Use a single slash command without terminal control characters')
    const session = this.active.get(sessionKey(target))
    if (!session || !this.isAttached(target)) throw new Error('Claude session is not connected')
    if (session.request.readOnly) throw new Error('This session is read-only')
    if (!session.isClaude || session.sending || session.nativeCommand || session.interruptRequested)
      throw new Error('Finish the current interaction first')
    session.sending = true
    try {
      const revision = session.inputRevision
      await this.refreshInputState(target, session)
      if (
        !this.isCurrent(target, session) ||
        !this.isAttached(target) ||
        revision !== session.inputRevision
      )
        throw new Error('Remote input changed; try again')
      if (session.status.promptState !== 'ready' || session.status.generating)
        throw new Error('Wait for Claude to finish or complete the native dialog')
      const input = [...(session.lastScreen ?? '').matchAll(/(?:^|\n)\s*❯([^\n]*)/gu)].at(-1)?.[1]
      if (input === undefined || input.trim())
        throw new Error('Clear or submit the existing remote input in the terminal first')
      if (changesConversation(command)) {
        const prepared = await this.ssh.runHelper(session.profile, [
          'prepare-native',
          '--name',
          target.sessionName
        ])
        if (prepared.exitCode !== 0)
          throw new Error('Update the remote bridge helper before switching conversations')
        if (
          !this.isCurrent(target, session) ||
          revision !== session.inputRevision ||
          !this.isAttached(target)
        )
          throw new Error('Remote input changed; try again')
      }
      // Suspend before sending: resume/clear can change the transcript immediately.
      session.nativeCommand = command
      this.transcripts.stop(target)
      const sequence = encodePromptForTerminal(text.trim()).sequence
      // Invalidate pre-command inspections before writing. A SessionStart hook
      // can run while the TUI is still redrawing; the old ready state is stale.
      this.refreshAfterInput(target, sequence)
      session.status = {
        ...session.status,
        promptState: 'checking',
        generating: false,
        changedAt: Date.now()
      }
      this.emitStatus(session.status)
      this.ptys.write(target, sequence)
    } finally {
      session.sending = false
    }
  }

  async finishCommand(target: SessionTarget): Promise<void> {
    const session = this.active.get(sessionKey(target))
    if (!session || !this.isAttached(target)) throw new Error('Claude session is not connected')
    if (session.request.readOnly) throw new Error('This session is read-only')
    if (session.sending) throw new Error('Wait for the command to be submitted')
    const revision = session.inputRevision
    await this.refreshInputState(target, session)
    if (
      !this.isCurrent(target, session) ||
      revision !== session.inputRevision ||
      session.status.promptState !== 'ready' ||
      session.status.generating
    )
      throw new Error('Complete or cancel the native interaction before returning')
    const command = session.nativeCommand
    // Re-read from the start after native interactions; never reuse a previous
    // conversation's byte offset or claim a historical launch argument is live.
    const id = await this.transcripts.restartVerified(
      session.profile,
      target,
      session.cwd,
      !!command && changesConversation(command)
    )
    if (!this.isCurrent(target, session)) return
    if (!this.isAttached(target) || revision !== session.inputRevision) {
      this.transcripts.stop(target)
      throw new Error(
        'Remote input changed while synchronizing; finish the native interaction and try again'
      )
    }
    if (!id && command && changesConversation(command))
      throw new Error(
        'Current conversation cannot be verified. Continue in the native terminal; create a new bridge session to enable live session tracking.'
      )
    session.nativeCommand = undefined
  }

  detach(input: SessionTarget): void {
    const target = SessionTargetSchema.parse(input)
    const session = this.active.get(sessionKey(target))
    if (!session) return
    session.manualDetach = true
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
    if (session.inputTimer) clearTimeout(session.inputTimer)
    this.transcripts.stop(target)
    if (this.ptys.has(target)) this.ptys.close(target)
    else {
      session.status = this.makeStatus(target, 'detached', session.request.readOnly, 0)
      this.emitStatus(session.status)
    }
  }

  detachProfile(profileId: string): void {
    for (const [key, session] of this.active) {
      if (session.request.profileId !== profileId) continue
      this.detach(session.request)
      this.active.delete(key)
    }
  }

  async create(input: CreateSessionRequest): Promise<RemoteSession> {
    const request = CreateSessionRequestSchema.parse(input)
    const profile = this.config.profile(request.profileId)
    const result = await this.ssh.runHelper(
      profile,
      [
        'create-session',
        '--name',
        request.sessionName,
        '--cwd',
        request.cwd,
        '--claude-path',
        profile.claudePath,
        '--session-id',
        randomUUID()
      ],
      30000
    )
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Unable to create session')
    const response = JSON.parse(result.stdout.trim()) as { session: RemoteSession }
    return response.session
  }

  async terminate(input: SessionTarget, confirmation: string): Promise<void> {
    const target = SessionTargetSchema.parse(input)
    if (confirmation !== target.sessionName)
      throw new Error('Session-name confirmation did not match')
    this.detach(target)
    const profile = this.config.profile(target.profileId)
    const result = await this.ssh.runHelper(profile, [
      'terminate-session',
      '--name',
      target.sessionName
    ])
    if (result.exitCode !== 0)
      throw new Error(result.stderr.trim() || 'Unable to terminate session')
    this.active.delete(sessionKey(target))
  }

  async rename(input: RenameSessionRequest): Promise<RemoteSession> {
    const request = RenameSessionRequestSchema.parse(input)
    if (this.isAttached(request)) throw new Error('Detach the session before renaming it')
    const profile = this.config.profile(request.profileId)
    const result = await this.ssh.runHelper(profile, [
      'rename-session',
      '--name',
      request.sessionName,
      '--new-name',
      request.newName
    ])
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'Unable to rename session')
    const response = JSON.parse(result.stdout.trim()) as { session: RemoteSession }
    return response.session
  }

  isAttached(target: SessionTarget): boolean {
    return this.active.get(sessionKey(target))?.status.state === 'attached' && this.ptys.has(target)
  }

  isReadOnly(target: SessionTarget): boolean {
    return this.active.get(sessionKey(target))?.request.readOnly ?? false
  }

  assertProfilesCanChange(profiles: Profile[]): void {
    for (const session of this.active.values()) {
      const target = session.request
      const active =
        this.ptys.has(target) ||
        (!session.manualDetach &&
          ['checking', 'connecting', 'reconnecting'].includes(session.status.state))
      if (!active) continue
      const next = profiles.find((profile) => profile.id === target.profileId)
      if (!next || connectionIdentity(next) !== connectionIdentity(session.profile)) {
        throw new Error(
          translate(this.config.get().language, 'main.disconnectBeforeEditing', {
            profile: session.profile.label
          })
        )
      }
    }
  }

  closeAll(): void {
    for (const session of this.active.values()) {
      session.manualDetach = true
      if (session.reconnectTimer) clearTimeout(session.reconnectTimer)
      if (session.inputTimer) clearTimeout(session.inputTimer)
    }
    this.transcripts.stopAll()
    this.ptys.closeAll()
  }

  private makeStatus(
    target: SessionTarget,
    state: SessionStatus['state'],
    readOnly: boolean,
    attempt: number,
    message?: string
  ): SessionStatus {
    return { ...target, state, readOnly, attempt, message, changedAt: Date.now() }
  }
}
