import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerWindowCommands } from '../../src/main/window-commands'
import { WINDOW_COMMAND_CHANNEL } from '../../src/shared/window-commands'
import type { BrowserWindow } from 'electron'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, command: unknown) => unknown>())
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, command: unknown) => unknown) =>
      handlers.set(channel, handler)
  }
}))

describe('window command boundary', () => {
  const contents = {
    mainFrame: {},
    sendInputEvent: vi.fn(),
    setZoomFactor: vi.fn(),
    getZoomFactor: () => 1.5
  }
  const window = { webContents: contents, close: vi.fn() }
  const event = { sender: contents, senderFrame: contents.mainFrame }
  const execute = (command: unknown, source: unknown = event) =>
    handlers.get(WINDOW_COMMAND_CHANNEL)!(source, command)
  beforeEach(() => {
    vi.clearAllMocks()
    registerWindowCommands(() => window as unknown as BrowserWindow)
  })
  it('rejects unknown commands, other windows and child frames', () => {
    expect(() => execute('unknown')).toThrow('Unknown window command')
    expect(() => execute('close', { ...event, sender: {} })).toThrow('Unknown window')
    expect(() => execute('close', { ...event, senderFrame: {} })).toThrow('Unknown window')
    expect(window.close).not.toHaveBeenCalled()
  })
  it('uses native close so the existing close-to-tray handler remains authoritative', () => {
    execute('close')
    expect(window.close).toHaveBeenCalledOnce()
    expect(contents.sendInputEvent).not.toHaveBeenCalled()
  })
  it('routes editing shortcuts and bounds zoom', () => {
    execute('undo')
    expect(contents.sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyDown', keyCode: 'Z' })
    )
    expect(contents.sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyUp', keyCode: 'Z' })
    )
    execute('zoomIn')
    expect(contents.setZoomFactor).toHaveBeenLastCalledWith(1.5)
    execute('zoomReset')
    expect(contents.setZoomFactor).toHaveBeenLastCalledWith(1)
  })
})
