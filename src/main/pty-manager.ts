import * as pty from 'node-pty'
import type { SessionTarget } from '../shared/contracts'
import { logger } from './logger'

interface ManagedPty {
  process: pty.IPty
  target: SessionTarget
  pendingOutput: string
  ready: boolean
  closing: boolean
  pendingSize?: { cols: number; rows: number }
  flushTimer?: ReturnType<typeof setTimeout>
}

export interface PtyExit {
  target: SessionTarget
  exitCode: number
  signal?: number
}

function environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

export function sessionKey(target: SessionTarget): string {
  return `${target.profileId}:${target.sessionName}`
}

export class PtyManager {
  private readonly processes = new Map<string, ManagedPty>()
  private readonly sizes = new Map<string, { cols: number; rows: number }>()

  constructor(
    private readonly onData: (target: SessionTarget, data: string) => void,
    private readonly onExit: (event: PtyExit) => void
  ) {}

  spawn(target: SessionTarget, executable: string, args: string[]): void {
    const key = sessionKey(target)
    if (this.processes.has(key)) throw new Error(`A terminal is already active for ${key}`)

    const processHandle = pty.spawn(executable, args, {
      name: 'xterm-256color',
      cols: this.sizes.get(key)?.cols ?? 120,
      rows: this.sizes.get(key)?.rows ?? 36,
      cwd: process.env.USERPROFILE ?? process.cwd(),
      env: { ...environment(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      useConpty: process.platform === 'win32'
    })
    const managed: ManagedPty = {
      process: processHandle,
      target,
      pendingOutput: '',
      ready: false,
      closing: false
    }
    this.processes.set(key, managed)

    processHandle.onData((data) => {
      if (!managed.ready)
        queueMicrotask(() => {
          managed.ready = true
          if (managed.pendingSize && !managed.closing) {
            const { cols, rows } = managed.pendingSize
            managed.pendingSize = undefined
            this.resize(target, cols, rows)
          }
        })
      this.queueOutput(managed, data)
    })
    processHandle.onExit(({ exitCode, signal }) => {
      logger.info(`PTY exited for ${key}: code=${exitCode}, signal=${signal ?? 'none'}`)
      managed.closing = true
      this.flush(managed)
      this.processes.delete(key)
      this.onExit({ target, exitCode, signal })
    })
    logger.info(`PTY started for ${key}`)
  }

  private queueOutput(managed: ManagedPty, data: string): void {
    managed.pendingOutput += data
    if (managed.pendingOutput.length >= 256_000) {
      this.flush(managed)
      return
    }
    managed.flushTimer ??= setTimeout(() => this.flush(managed), 12)
  }

  private flush(managed: ManagedPty): void {
    if (managed.flushTimer) clearTimeout(managed.flushTimer)
    managed.flushTimer = undefined
    if (!managed.pendingOutput) return
    const data = managed.pendingOutput
    managed.pendingOutput = ''
    this.onData(managed.target, data)
  }

  has(target: SessionTarget): boolean {
    return this.processes.has(sessionKey(target))
  }

  write(target: SessionTarget, data: string): void {
    const managed = this.processes.get(sessionKey(target))
    if (!managed) throw new Error('The terminal is not connected')
    managed.process.write(data)
  }

  resize(target: SessionTarget, cols: number, rows: number): void {
    const key = sessionKey(target)
    this.sizes.set(key, { cols, rows })
    const managed = this.processes.get(key)
    if (!managed || managed.closing) return
    // ConPTY queues early resize calls internally and can execute them after exit.
    // Wait for the first output before calling resize, and keep only the latest size.
    if (!managed.ready) {
      managed.pendingSize = { cols, rows }
      return
    }
    try {
      managed.process.resize(cols, rows)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already exited')) throw error
    }
  }

  close(target: SessionTarget): void {
    const managed = this.processes.get(sessionKey(target))
    if (!managed) return
    managed.closing = true
    if (managed.flushTimer) clearTimeout(managed.flushTimer)
    managed.process.kill()
  }

  closeAll(): void {
    for (const managed of [...this.processes.values()]) {
      managed.closing = true
      if (managed.flushTimer) clearTimeout(managed.flushTimer)
      managed.process.kill()
    }
  }
}
