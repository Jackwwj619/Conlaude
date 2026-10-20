import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../../src/main/session-manager'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { ConfigStore } from '../../src/main/config-store'
import type { SshClient } from '../../src/main/ssh-client'
import type { PtyManager } from '../../src/main/pty-manager'
import type { TranscriptWatcher } from '../../src/main/transcript-watcher'
import type { Profile } from '../../src/shared/contracts'
import { TERMINAL_CONTROL_SEQUENCES } from '../../src/shared/terminal-controls'

vi.mock('../../src/main/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('../../src/main/pty-manager', () => ({
  sessionKey: (target: { profileId: string; sessionName: string }) =>
    `${target.profileId}:${target.sessionName}`,
  PtyManager: vi.fn()
}))

function setup() {
  const profile = { ...DEFAULT_SETTINGS.profiles[0]!, id: 'exp', sshHost: 'exp', claudePath: 'cc' }
  const target = { profileId: profile.id, sessionName: 'bridge-test' }
  const config = { profile: vi.fn(() => profile), get: () => DEFAULT_SETTINGS }
  const ssh = {
    sshPath: 'ssh',
    runHelper: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ session: { name: target.sessionName, isClaude: true } }),
      stderr: ''
    }),
    interactiveArgs: vi
      .fn<(profile: Profile, command: string) => string[]>()
      .mockReturnValue(['exp']),
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'bridge-test\n', stderr: '' })
  }
  const ptys = {
    has: vi.fn(() => false),
    spawn: vi.fn(),
    close: vi.fn(),
    closeAll: vi.fn(),
    write: vi.fn()
  }
  const transcripts = {
    start: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    restartVerified: vi.fn().mockResolvedValue('current-id')
  }
  const emit = vi.fn()
  const manager = new SessionManager(
    config as unknown as ConfigStore,
    ssh as unknown as SshClient,
    ptys as unknown as PtyManager,
    transcripts as unknown as TranscriptWatcher,
    emit
  )
  return { manager, profile, target, ssh, ptys, emit, transcripts }
}

afterEach(() => vi.useRealTimers())

describe('connection identity and lifecycle', () => {
  it('executes native commands through the PTY, suspends history and verifies before returning', async () => {
    vi.useFakeTimers()
    const { manager, target, ssh, ptys, transcripts, emit } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run.mockResolvedValue({ exitCode: 0, stdout: '❯\n? for shortcuts', stderr: '' })
    await manager.runCommand(target, '/resume')
    expect(emit.mock.lastCall?.[0].promptState).toBe('checking')
    expect(ptys.write).toHaveBeenCalledExactlyOnceWith(target, '\u001b[200~/resume\u001b[201~\r')
    expect(transcripts.stop).toHaveBeenCalledWith(target)
    await expect(manager.sendPrompt(target, 'hello')).rejects.toThrow('native interaction')
    await expect(manager.runCommand(target, '/clear')).rejects.toThrow('current interaction')
    transcripts.restartVerified.mockResolvedValueOnce(undefined)
    await expect(manager.finishCommand(target)).rejects.toThrow('cannot be verified')
    await manager.finishCommand(target)
    expect(transcripts.restartVerified).toHaveBeenLastCalledWith(
      expect.anything(),
      target,
      expect.anything(),
      true
    )
    manager.closeAll()
  })

  it('never submits commands into busy screens, existing remote input, or a read-only session', async () => {
    vi.useFakeTimers()
    const { manager, target, ssh, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    for (const screen of [
      '❯ unfinished text\n? for shortcuts',
      'Enter to confirm',
      '✻ Thinking… (esc to interrupt · 2s)\n❯\n? for shortcuts'
    ]) {
      ssh.run.mockResolvedValue({ exitCode: 0, stdout: screen, stderr: '' })
      await expect(manager.runCommand(target, '/model')).rejects.toThrow()
    }
    await expect(manager.runCommand(target, '/model\u001b')).rejects.toThrow()
    expect(ptys.write).not.toHaveBeenCalled()
    manager.closeAll()
    ptys.has.mockReturnValue(false)
    await manager.attach({ ...target, readOnly: true })
    ptys.has.mockReturnValue(true)
    await expect(manager.runCommand(target, '/model')).rejects.toThrow('read-only')
    manager.closeAll()
  })
  it('interrupts only live Claude generation, deduplicates Escape, and preserves confirmation screens', async () => {
    vi.useFakeTimers()
    const { manager, target, ssh, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '✻ Thinking… (esc to interrupt · 2s)\n❯\n? for shortcuts',
      stderr: ''
    })
    await manager.interruptPrompt(target)
    await expect(manager.sendPrompt(target, 'new message')).rejects.toThrow('正在停止')
    await manager.interruptPrompt(target)
    expect(ptys.write).toHaveBeenCalledExactlyOnceWith(target, '\u001b')
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '⎿ Interrupted · What should Claude do instead?\n❯\n? for shortcuts',
      stderr: ''
    })
    await vi.advanceTimersByTimeAsync(1500)
    ptys.write.mockClear()
    await manager.interruptPrompt(target)
    expect(ptys.write).not.toHaveBeenCalled()
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: 'Do you trust the files in this folder?\n1. Yes\n2. No, exit',
      stderr: ''
    })
    await manager.interruptPrompt(target)
    expect(ptys.write).not.toHaveBeenCalled()
    manager.closeAll()
  })
  it('does not interrupt using a stale screen when terminal input changes during inspection', async () => {
    vi.useFakeTimers()
    const { manager, target, ssh, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    let finish!: (result: { exitCode: number; stdout: string; stderr: string }) => void
    ssh.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const interrupt = manager.interruptPrompt(target)
    await expect(manager.sendPrompt(target, 'new message')).rejects.toThrow('正在停止')
    manager.refreshAfterInput(target, '\r')
    finish({
      exitCode: 0,
      stdout: '✻ Thinking… (esc to interrupt · 2s)\n❯\n? for shortcuts',
      stderr: ''
    })
    await expect(interrupt).rejects.toThrow('未能停止生成')
    expect(ptys.write).not.toHaveBeenCalled()
    manager.closeAll()
  })
  it('observes live generation after output and clears it after completion or disconnect', async () => {
    vi.useFakeTimers()
    const { manager, ssh, target, ptys, emit } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run.mockResolvedValue({ exitCode: 0, stdout: '❯\n? for shortcuts', stderr: '' })
    await vi.advanceTimersByTimeAsync(1500)
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '✻ Thinking… (esc to interrupt · 2s)\n❯\n? for shortcuts',
      stderr: ''
    })
    manager.refreshAfterOutput(target)
    manager.refreshAfterOutput(target)
    await vi.advanceTimersByTimeAsync(800)
    expect(emit.mock.lastCall?.[0]).toMatchObject({ generating: true })
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '✻ Worked for 2s\n❯\n? for shortcuts',
      stderr: ''
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(emit.mock.lastCall?.[0]).toMatchObject({ generating: false })
    manager.onPtyExit({ target, exitCode: 1 })
    expect(emit.mock.lastCall?.[0].generating).not.toBe(true)
    manager.closeAll()
  })

  it('refreshes the native mode immediately after Shift+Tab even when input is already ready', async () => {
    vi.useFakeTimers()
    const { manager, ssh, target, ptys, emit } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run.mockResolvedValue({ exitCode: 0, stdout: '❯\n? for shortcuts', stderr: '' })
    await vi.advanceTimersByTimeAsync(1500)
    expect(emit.mock.lastCall?.[0]).toMatchObject({
      promptState: 'ready',
      permissionMode: 'default'
    })
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '❯\n⏵⏵ accept edits on (shift+tab to cycle)',
      stderr: ''
    })
    manager.refreshAfterInput(target, TERMINAL_CONTROL_SEQUENCES.shiftTab)
    await vi.advanceTimersByTimeAsync(150)
    expect(emit.mock.lastCall?.[0]).toMatchObject({
      promptState: 'ready',
      permissionMode: 'acceptEdits'
    })
    expect(TERMINAL_CONTROL_SEQUENCES.shiftTab).toBe('\u001b[Z')
    manager.detach(target)
    ssh.run.mockClear()
    manager.refreshAfterInput(target, TERMINAL_CONTROL_SEQUENCES.shiftTab)
    await vi.advanceTimersByTimeAsync(1500)
    expect(ssh.run).not.toHaveBeenCalled()
    manager.closeAll()
  })

  it('does not let a screen captured before the mode switch overwrite the new mode', async () => {
    vi.useFakeTimers()
    const { manager, ssh, target, ptys, emit } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    let finish!: (value: unknown) => void
    ssh.run.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done
        })
    )
    await vi.advanceTimersByTimeAsync(1500)
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '❯\nplan mode on (shift+tab to cycle)',
      stderr: ''
    })
    manager.refreshAfterInput(target, TERMINAL_CONTROL_SEQUENCES.shiftTab)
    await vi.advanceTimersByTimeAsync(150)
    expect(emit.mock.lastCall?.[0].permissionMode).toBe('plan')
    finish({ exitCode: 0, stdout: '❯\nmanual mode on', stderr: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(emit.mock.lastCall?.[0].permissionMode).toBe('plan')
    manager.closeAll()
  })
  it('disconnects only the removed server and cancels pending attaches', async () => {
    const { manager, ssh, target, ptys, emit } = setup()
    const other = { ...target, profileId: 'other' }
    await manager.attach(other)
    const otherStatus = emit.mock.lastCall?.[0]
    let finish!: (value: unknown) => void
    ssh.runHelper.mockImplementation(
      () =>
        new Promise((done) => {
          finish = done
        })
    )
    const pending = manager.attach(target)
    manager.detachProfile(target.profileId)
    expect(() => manager.assertProfilesCanChange([])).not.toThrow()
    const detached = emit.mock.lastCall?.[0]
    expect(detached).toMatchObject({ ...target, state: 'detached' })
    finish({ exitCode: 0, stdout: JSON.stringify({ session: { name: target.sessionName } }) })
    await expect(pending).resolves.toMatchObject({ state: 'detached' })
    expect(ptys.spawn).toHaveBeenCalledTimes(1)
    manager.onPtyExit({ target, exitCode: 1 })
    expect(emit.mock.lastCall?.[0]).toBe(detached)
    expect(otherStatus).toMatchObject({ ...other, state: 'attached' })
    manager.closeAll()
  })

  it('closes all local terminals for a deleted server and stops reconnecting', async () => {
    vi.useFakeTimers()
    const { manager, target, ptys, ssh } = setup()
    ssh.runHelper.mockImplementation(async (_profile: Profile, args: string[]) => ({
      exitCode: 0,
      stdout: JSON.stringify({ session: { name: args[2], isClaude: false } }),
      stderr: ''
    }))
    const second = { ...target, sessionName: 'second' }
    const other = { ...target, profileId: 'other' }
    await manager.attach(target)
    await manager.attach(second)
    await manager.attach(other)
    ptys.has.mockReturnValue(true)
    manager.detachProfile(target.profileId)
    expect(ptys.close.mock.calls).toEqual([[target], [second]])
    manager.onPtyExit({ target, exitCode: 1 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(ssh.run).not.toHaveBeenCalled()
    expect(manager.isAttached(other)).toBe(true)
    manager.closeAll()
  })
  it('blocks endpoint edits during inspection but permits presentation edits', async () => {
    const { manager, ssh, profile, target } = setup()
    let resolve!: (value: unknown) => void
    ssh.runHelper.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = manager.attach(target)
    expect(() => manager.assertProfilesCanChange([{ ...profile, sshHost: 'other' }])).toThrow()
    expect(() =>
      manager.assertProfilesCanChange([{ ...profile, label: 'New label' }])
    ).not.toThrow()
    expect(() => manager.assertProfilesCanChange([])).toThrow()
    resolve({ exitCode: 0, stdout: JSON.stringify({ session: { name: target.sessionName } }) })
    await pending
    manager.closeAll()
  })

  it('does not open a PTY if detached while remote inspection was pending', async () => {
    const { manager, ssh, target, ptys } = setup()
    let resolve!: (value: unknown) => void
    ssh.runHelper.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const pending = manager.attach(target)
    manager.detach(target)
    resolve({ exitCode: 0, stdout: JSON.stringify({ session: { name: target.sessionName } }) })
    expect((await pending).state).toBe('detached')
    expect(ptys.spawn).not.toHaveBeenCalled()
  })

  it('publishes a failure and releases the profile after inspection throws', async () => {
    const { manager, ssh, target, profile, emit } = setup()
    ssh.runHelper.mockRejectedValue(new Error('SSH timeout'))
    await expect(manager.attach(target)).rejects.toThrow('SSH timeout')
    expect(emit.mock.lastCall?.[0].state).toBe('failed')
    expect(() => manager.assertProfilesCanChange([{ ...profile, sshHost: 'new' }])).not.toThrow()
  })

  it('reconnects using the original profile snapshot', async () => {
    vi.useFakeTimers()
    const { manager, ssh, target, profile } = setup()
    await manager.attach(target)
    profile.sshHost = 'changed-outside-manager'
    manager.onPtyExit({ target, exitCode: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(ssh.interactiveArgs.mock.lastCall?.[0]).toMatchObject({ sshHost: 'exp' })
    manager.closeAll()
  })

  it('passes the configured Claude command to remote session creation', async () => {
    const { manager, ssh, target } = setup()
    await manager.create({ ...target, cwd: '~' })
    expect(ssh.runHelper.mock.lastCall?.[1]).toEqual(
      expect.arrayContaining(['--claude-path', 'cc'])
    )
  })

  it('waits for image paste to settle before writing a separate Enter', async () => {
    const { manager, ssh, target, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run
      .mockResolvedValueOnce({ exitCode: 0, stdout: '❯\nmanual mode on', stderr: '' })
      .mockResolvedValue({
        exitCode: 0,
        stdout: '❯ [Image #1] describe\nmanual mode on',
        stderr: ''
      })
    const sending = manager.sendPrompt(target, '\u001b[200~describe /tmp/test.png\u001b[201~\r')
    await vi.waitFor(() => expect(ptys.write).toHaveBeenCalledTimes(1))
    expect(ptys.write.mock.calls[0]![1]).toBe('\u001b[200~describe /tmp/test.png\u001b[201~')
    await sending
    expect(ptys.write).toHaveBeenLastCalledWith(target, '\r')
    expect(ptys.write).toHaveBeenCalledTimes(2)
    manager.closeAll()
  })

  it('does not send Enter if a confirmation appears while processing an image paste', async () => {
    const { manager, ssh, target, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run
      .mockResolvedValueOnce({ exitCode: 0, stdout: '❯\nmanual mode on', stderr: '' })
      .mockResolvedValue({ exitCode: 0, stdout: '❯ Yes\nEnter to confirm', stderr: '' })
    await expect(manager.sendPrompt(target, '\u001b[200~image.png\u001b[201~\r')).rejects.toThrow()
    expect(ptys.write).toHaveBeenCalledExactlyOnceWith(target, '\u001b[200~image.png\u001b[201~')
    manager.closeAll()
  })

  it('blocks Enter at folder consent, then permits a message after the prompt is ready', async () => {
    const { manager, ssh, target, ptys, emit } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '❯ No, exit\n  Yes, I trust this folder\nEnter to confirm',
      stderr: ''
    })
    await expect(manager.sendPrompt(target, 'hello\r')).rejects.toThrow(/确认/)
    expect(ptys.write).not.toHaveBeenCalled()
    expect(emit.mock.lastCall?.[0].promptState).toBe('confirmation')
    ssh.run.mockResolvedValue({
      exitCode: 0,
      stdout: '❯\n⏸ manual mode on · ← for agents',
      stderr: ''
    })
    await manager.sendPrompt(target, 'hello\r')
    expect(ptys.write).toHaveBeenCalledExactlyOnceWith(target, 'hello\r')
    manager.closeAll()
  })

  it('does not reuse ready state if a later inspection fails', async () => {
    const { manager, ssh, target, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    ssh.run.mockResolvedValueOnce({ exitCode: 0, stdout: '❯\nmanual mode on', stderr: '' })
    await manager.sendPrompt(target, 'first\r')
    ssh.run.mockRejectedValueOnce(new Error('network timeout'))
    await expect(manager.sendPrompt(target, 'second\r')).rejects.toThrow(/无法确认/)
    expect(ptys.write).toHaveBeenCalledTimes(1)
    manager.closeAll()
  })

  it('does not write a pending message if the user detaches during inspection', async () => {
    const { manager, ssh, target, ptys } = setup()
    await manager.attach(target)
    ptys.has.mockReturnValue(true)
    let finish!: (value: unknown) => void
    ssh.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const sending = manager.sendPrompt(target, 'hello\r')
    manager.detach(target)
    finish({ exitCode: 0, stdout: '❯\nmanual mode on', stderr: '' })
    await expect(sending).rejects.toThrow('not connected')
    expect(ptys.write).not.toHaveBeenCalled()
  })

  it('stops reconnecting when the remote session has ended', async () => {
    vi.useFakeTimers()
    const { manager, ssh, target, ptys, emit } = setup()
    await manager.attach(target)
    ssh.run.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'no server running on /tmp/tmux-1000/default'
    })
    manager.onPtyExit({ target, exitCode: 0 })
    await vi.advanceTimersByTimeAsync(120000)
    expect(ptys.spawn).toHaveBeenCalledTimes(1)
    expect(emit.mock.lastCall?.[0]).toMatchObject({
      state: 'failed',
      message: expect.stringContaining('已停止重连')
    })
    manager.closeAll()
  })

  it('keeps retrying a network outage, then reconnects when the session is found', async () => {
    vi.useFakeTimers()
    const { manager, ssh, target, ptys, emit } = setup()
    await manager.attach(target)
    ssh.run.mockResolvedValueOnce({ exitCode: 255, stdout: '', stderr: 'SSH timed out' })
    manager.onPtyExit({ target, exitCode: 255 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(emit.mock.lastCall?.[0].state).toBe('reconnecting')
    expect(ptys.spawn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(ptys.spawn).toHaveBeenCalledTimes(2)
    manager.closeAll()
  })
})
