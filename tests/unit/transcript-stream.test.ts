import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranscriptWatcher } from '../../src/main/transcript-watcher'
import type { SshClient } from '../../src/main/ssh-client'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { logger } from '../../src/main/logger'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const spawn = vi.fn()
  return { ...actual, spawn, default: { ...actual, spawn } }
})
vi.mock('../../src/main/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/pty-manager', () => ({
  sessionKey: (target: { profileId: string; sessionName: string }) =>
    `${target.profileId}:${target.sessionName}`
}))

const target = { profileId: 'mas', sessionName: 'stream-test' }
const watchers: TranscriptWatcher[] = []
function setup() {
  const children: ReturnType<typeof createChild>[] = []
  function createChild() {
    return Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn()
    })
  }
  vi.mocked(spawn).mockImplementation(() => {
    const child = createChild()
    children.push(child)
    return child as unknown as ChildProcess
  })
  const discovery = {
    exitCode: 0,
    stdout: JSON.stringify({ boundSessionId: 'test-id' }),
    stderr: ''
  }
  const ssh = {
    sshPath: 'ssh',
    runHelper: vi.fn().mockResolvedValue(discovery),
    watchArgs: vi.fn().mockReturnValue([])
  }
  const event = vi.fn(),
    reset = vi.fn(),
    status = vi.fn()
  const watcher = new TranscriptWatcher(ssh as unknown as SshClient, event, reset, status)
  watchers.push(watcher)
  const start = () => watcher.start(DEFAULT_SETTINGS.profiles[0]!, target)
  return { watcher, start, children, event, reset, status, ssh, discovery }
}
function packet(id: string, text: string, offset = 321): Buffer {
  return Buffer.from(
    JSON.stringify({
      offset,
      event: {
        uuid: id,
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text }] }
      }
    }) + '\n'
  )
}
afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.stopAll()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('transcript stream lifecycle', () => {
  it('refuses a stale launch mapping after a native conversation switch', async () => {
    const { watcher, ssh, children, status } = setup()
    await expect(
      watcher.restartVerified(DEFAULT_SETTINGS.profiles[0]!, target, undefined, true)
    ).resolves.toBeUndefined()
    expect(children).toHaveLength(0)
    expect(status.mock.lastCall?.[1].reason).toBe('association')
    ssh.runHelper.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ boundSessionId: 'new-id', liveBinding: true }),
      stderr: ''
    })
    await expect(
      watcher.restartVerified(DEFAULT_SETTINGS.profiles[0]!, target, undefined, true)
    ).resolves.toBe('new-id')
    expect(children).toHaveLength(1)
  })
  it('preserves Chinese and emoji across every UTF-8 byte boundary', async () => {
    const { start, children, event } = setup()
    await expect(start()).resolves.toBe('test-id')
    expect(children).toHaveLength(1)
    expect(vi.mocked(logger.error).mock.calls).toEqual([])
    expect(vi.mocked(logger.warn).mock.calls).toEqual([])
    const text = '中文回复：你好🌏'
    const buffer = packet('unicode', text)
    for (let split = 1; split < buffer.length; split++) {
      children[0]!.stdout.emit('data', buffer.subarray(0, split))
      children[0]!.stdout.emit('data', buffer.subarray(split))
      expect(event.mock.lastCall?.[1].text).toBe(text)
    }
    expect(event).toHaveBeenCalledTimes(buffer.length - 1)
  })
  it('recovers a transcript-only exit from its offset without clearing history', async () => {
    vi.useFakeTimers()
    const { start, children, event, reset, status, ssh } = setup()
    await start()
    children[0]!.stdout.emit('data', packet('first', 'first'))
    children[0]!.emit('close', 255)
    expect(status.mock.lastCall?.[1].state).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(children).toHaveLength(2)
    expect(ssh.watchArgs.mock.lastCall?.[1]).toContain("'321'")
    expect(reset).toHaveBeenCalledTimes(1)
    children[0]!.stdout.emit('data', packet('stale', 'stale'))
    expect(event).toHaveBeenCalledTimes(1)
    children[1]!.stdout.emit('data', packet('second', 'second', 600))
    expect(event.mock.lastCall?.[1].text).toBe('second')
    expect(status.mock.lastCall?.[1].state).toBe('live')
  })
  it('cancels recovery when detached and ignores a late discovery response', async () => {
    vi.useFakeTimers()
    const { start, children, watcher, ssh, discovery } = setup()
    await start()
    children[0]!.emit('close', 255)
    watcher.stop(target)
    await vi.advanceTimersByTimeAsync(60000)
    expect(children).toHaveLength(1)
    let complete!: (value: typeof discovery) => void
    ssh.runHelper.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const pending = start()
    watcher.stop(target)
    complete(discovery)
    await pending
    expect(children).toHaveLength(1)
  })
  it('handles failed discovery and backs off without an unhandled rejection', async () => {
    vi.useFakeTimers()
    const { start, ssh, status, children } = setup()
    ssh.runHelper.mockRejectedValueOnce(new Error('network unavailable'))
    await expect(start()).resolves.toBeUndefined()
    expect(status.mock.lastCall?.[1]).toMatchObject({ state: 'reconnecting', attempt: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    children[0]!.emit('error', new Error('connection refused'))
    children[0]!.emit('close', 255)
    await vi.advanceTimersByTimeAsync(1999)
    expect(children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(2)
  })
})
