import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { Profile, SessionTarget, TimelineEvent, TranscriptStatus } from '../shared/contracts'
import { normalizeTranscriptEvent } from '../shared/transcript'
import { logger } from './logger'
import { helperCommand, SshClient } from './ssh-client'
import { sessionKey } from './pty-manager'

export interface DiscoveryResponse {
  candidates?: Array<{ sessionId: string; modifiedAt: number; bytes: number }>
  boundSessionId?: string
  binding?: 'mapping' | 'process-argument' | 'heuristic'
  liveBinding?: boolean
}

export interface TranscriptSelection {
  sessionId: string
  waitForFile: boolean
}

export function selectTranscript(response: DiscoveryResponse): TranscriptSelection | undefined {
  if (response.boundSessionId) {
    return { sessionId: response.boundSessionId, waitForFile: true }
  }
  const [candidate] = response.candidates ?? []
  if (response.binding === 'heuristic' && response.candidates?.length === 1 && candidate) {
    return { sessionId: candidate.sessionId, waitForFile: false }
  }
  return undefined
}

interface WatchEnvelope {
  reset?: boolean
  sessionId?: string
  offset?: number
  event?: unknown
  parseError?: boolean
}

interface ActiveWatcher {
  child: ChildProcess
  sessionId: string
  offset: number
  buffer: string
  decoder: StringDecoder
  live?: boolean
}

interface Subscription {
  profile: Profile
  target: SessionTarget
  cwd: string
  attempt: number
  initializedId?: string
  watcher?: ActiveWatcher
  retryTimer?: ReturnType<typeof setTimeout>
  requireLive?: boolean
}

const RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000]

export class TranscriptWatcher {
  private readonly active = new Map<string, Subscription>()
  private readonly offsets = new Map<string, number>()

  constructor(
    private readonly ssh: SshClient,
    private readonly onEvent: (target: SessionTarget, event: TimelineEvent) => void,
    private readonly onReset: (target: SessionTarget) => void,
    private readonly onStatus: (target: SessionTarget, status: TranscriptStatus) => void = () => {}
  ) {}

  async start(
    profile: Profile,
    target: SessionTarget,
    cwd = profile.defaultCwd
  ): Promise<string | undefined> {
    this.stop(target)
    const subscription: Subscription = { profile: { ...profile }, target, cwd, attempt: 0 }
    this.active.set(sessionKey(target), subscription)
    this.onStatus(target, { state: 'connecting', attempt: 0 })
    return this.connect(subscription)
  }

  private current(subscription: Subscription): boolean {
    return this.active.get(sessionKey(subscription.target)) === subscription
  }

  async restartVerified(
    profile: Profile,
    target: SessionTarget,
    cwd = profile.defaultCwd,
    requireLive = false
  ): Promise<string | undefined> {
    this.stop(target)
    for (const key of this.offsets.keys()) {
      if (key.startsWith(`${sessionKey(target)}:`)) this.offsets.delete(key)
    }
    this.onReset(target)
    const subscription: Subscription = {
      profile: { ...profile },
      target,
      cwd,
      attempt: 0,
      requireLive
    }
    this.active.set(sessionKey(target), subscription)
    this.onStatus(target, { state: 'connecting', attempt: 0 })
    return this.connect(subscription)
  }

  private retry(subscription: Subscription, reason: TranscriptStatus['reason']): void {
    if (!this.current(subscription) || subscription.retryTimer) return
    const attempt = ++subscription.attempt
    this.onStatus(subscription.target, {
      state: reason === 'association' ? 'unavailable' : 'reconnecting',
      attempt,
      reason
    })
    subscription.retryTimer = setTimeout(
      () => {
        subscription.retryTimer = undefined
        if (this.current(subscription)) void this.connect(subscription)
      },
      RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]
    )
  }

  private async connect(subscription: Subscription): Promise<string | undefined> {
    const { profile, target, cwd } = subscription
    try {
      const discovery = await this.ssh.runHelper(profile, [
        'discover-transcript',
        '--session-name',
        target.sessionName,
        '--cwd',
        cwd
      ])
      if (!this.current(subscription)) return undefined
      if (discovery.exitCode !== 0) {
        logger.warn(`Transcript discovery unavailable for ${sessionKey(target)}`)
        this.retry(subscription, 'connection')
        return undefined
      }

      let response: DiscoveryResponse
      try {
        response = JSON.parse(discovery.stdout.trim()) as DiscoveryResponse
      } catch {
        logger.warn(`Transcript discovery returned invalid JSON for ${sessionKey(target)}`)
        this.retry(subscription, 'connection')
        return undefined
      }

      const selection =
        subscription.requireLive && !response.liveBinding ? undefined : selectTranscript(response)
      if (!selection) {
        logger.warn(`Transcript association is unavailable or ambiguous for ${sessionKey(target)}`)
        this.retry(subscription, 'association')
        return undefined
      }
      const { sessionId } = selection
      const offsetKey = `${sessionKey(target)}:${sessionId}`
      const offset = this.offsets.get(offsetKey) ?? 0
      if (offset === 0 && subscription.initializedId !== sessionId) this.onReset(target)
      subscription.initializedId = sessionId
      const command = helperCommand([
        'watch-transcript',
        '--session-id',
        sessionId,
        '--offset',
        String(offset),
        ...(selection.waitForFile ? ['--wait-for-file'] : [])
      ])
      const child = spawn(this.ssh.sshPath, this.ssh.watchArgs(profile, command), {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const watcher: ActiveWatcher = {
        child,
        sessionId,
        offset,
        buffer: '',
        decoder: new StringDecoder('utf8')
      }
      subscription.watcher = watcher
      child.stdout.on('data', (chunk: Buffer) => {
        if (!this.current(subscription) || subscription.watcher !== watcher) return
        this.consume(target, watcher, watcher.decoder.write(chunk))
        if (!watcher.live) {
          watcher.live = true
          subscription.attempt = 0
          this.onStatus(target, { state: 'live', attempt: 0 })
        }
      })
      child.stderr.on('data', () => undefined)
      const failed = (): void => {
        if (!this.current(subscription) || subscription.watcher !== watcher) return
        subscription.watcher = undefined
        child.kill()
        this.retry(subscription, 'connection')
      }
      child.on('close', failed)
      child.on('error', (error) => {
        logger.error('Transcript watcher failed', error)
        failed()
      })
      return sessionId
    } catch (error) {
      if (this.current(subscription)) {
        logger.error('Transcript discovery failed', error)
        this.retry(subscription, 'connection')
      }
      return undefined
    }
  }

  private consume(target: SessionTarget, watcher: ActiveWatcher, chunk: string): void {
    watcher.buffer += chunk
    if (watcher.buffer.length > 2_000_000) {
      watcher.buffer = ''
      logger.warn(`Transcript buffer safety limit reached for ${sessionKey(target)}`)
      return
    }

    const lines = watcher.buffer.split('\n')
    watcher.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const envelope = JSON.parse(line) as WatchEnvelope
        if (envelope.reset) this.onReset(target)
        if (typeof envelope.offset === 'number') {
          watcher.offset = envelope.offset
          this.offsets.set(`${sessionKey(target)}:${watcher.sessionId}`, envelope.offset)
        }
        if (envelope.parseError || envelope.event === undefined) continue
        for (const event of normalizeTranscriptEvent(envelope.event, envelope.offset)) {
          this.onEvent(target, event)
        }
      } catch {
        logger.warn(`Ignored malformed transcript envelope for ${sessionKey(target)}`)
      }
    }
  }

  stop(target: SessionTarget): void {
    const key = sessionKey(target)
    const subscription = this.active.get(key)
    if (!subscription) return
    this.active.delete(key)
    clearTimeout(subscription.retryTimer)
    subscription.watcher?.child.kill()
  }

  stopAll(): void {
    for (const subscription of this.active.values()) this.stop(subscription.target)
  }
}
