import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyManager } from '../../src/main/pty-manager'

const native = vi.hoisted(() => ({
  resize: vi.fn(),
  kill: vi.fn(),
  write: vi.fn(),
  data: undefined as ((data: string) => void) | undefined,
  exit: undefined as ((event: { exitCode: number }) => void) | undefined
}))
vi.mock('node-pty', () => ({
  spawn: () => ({
    resize: native.resize,
    kill: native.kill,
    write: native.write,
    onData: (handler: (data: string) => void) => {
      native.data = handler
    },
    onExit: (handler: (event: { exitCode: number }) => void) => {
      native.exit = handler
    }
  })
}))
vi.mock('../../src/main/logger', () => ({ logger: { info: vi.fn() } }))
const target = { profileId: 'exp', sessionName: 'test' }

beforeEach(() => {
  vi.clearAllMocks()
  native.resize.mockReset()
})

describe('PTY resize lifecycle', () => {
  it('coalesces early sizes until the first data callback has fully completed', async () => {
    const manager = new PtyManager(vi.fn(), vi.fn())
    manager.spawn(target, 'ssh', ['exp'])
    manager.resize(target, 90, 25)
    manager.resize(target, 100, 30)
    expect(native.resize).not.toHaveBeenCalled()
    native.data?.('ready')
    expect(native.resize).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(native.resize).toHaveBeenCalledExactlyOnceWith(100, 30)
    manager.closeAll()
  })

  it('does not queue a native resize after a close while startup was pending', async () => {
    const manager = new PtyManager(vi.fn(), vi.fn())
    manager.spawn(target, 'ssh', ['exp'])
    manager.resize(target, 90, 25)
    manager.close(target)
    native.data?.('exited')
    await Promise.resolve()
    expect(native.resize).not.toHaveBeenCalled()
    native.exit?.({ exitCode: 0 })
    expect(manager.has(target)).toBe(false)
  })

  it('tolerates the ConPTY exited race but surfaces other resize failures', async () => {
    const manager = new PtyManager(vi.fn(), vi.fn())
    manager.spawn(target, 'ssh', ['exp'])
    native.data?.('ready')
    await Promise.resolve()
    native.resize.mockImplementation(() => {
      throw new Error('Cannot resize a pty that has already exited')
    })
    expect(() => manager.resize(target, 80, 24)).not.toThrow()
    native.resize.mockImplementation(() => {
      throw new Error('Unexpected failure')
    })
    expect(() => manager.resize(target, 80, 24)).toThrow('Unexpected failure')
    manager.closeAll()
  })
})
