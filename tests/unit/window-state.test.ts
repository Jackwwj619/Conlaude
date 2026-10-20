import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('electron-store', () => ({
  default: class {
    get = storage.get
    set = storage.set
  }
}))
vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
  }
}))
vi.mock('../../src/main/logger', () => ({ logger: { warn: vi.fn() } }))
import {
  createWindowState,
  fitWindowBounds,
  restoreWindowBounds
} from '../../src/main/window-state'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  storage.get.mockReturnValue(undefined)
})
afterEach(() => vi.useRealTimers())

it('keeps stored bounds within the current display, including a removed monitor', () => {
  expect(
    fitWindowBounds(
      { x: 2600, y: -500, width: 1600, height: 1000 },
      { x: 0, y: 0, width: 1280, height: 800 }
    )
  ).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
  storage.get.mockReturnValue({
    bounds: { x: 10, y: 20, width: 1100, height: 750 },
    maximized: true
  })
  expect(createWindowState()).toMatchObject({
    bounds: { x: 10, y: 20, width: 1100, height: 750 },
    maximized: true
  })
})

it('flushes the latest normal bounds on close and preserves them when closed minimized', () => {
  const bounds = { x: 100, y: 80, width: 1200, height: 800 }
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isMinimized: vi.fn(() => false),
    isFullScreen: () => false,
    getNormalBounds: vi.fn(() => bounds)
  })
  createWindowState().track(window as unknown as BrowserWindow)
  window.emit('resize')
  expect(storage.set).not.toHaveBeenCalled()
  window.emit('close')
  expect(storage.set).toHaveBeenLastCalledWith('window', { bounds, maximized: false })
  window.emit('maximize')
  vi.advanceTimersByTime(250)
  window.isMinimized.mockReturnValue(true)
  window.getNormalBounds.mockReturnValue({ x: -32000, y: -32000, width: 160, height: 28 })
  window.emit('close')
  expect(storage.set).toHaveBeenLastCalledWith('window', { bounds, maximized: true })
  window.emit('closed')
})

it('corrects native frame rounding without growing the saved window on each launch', () => {
  const bounds = { x: 60, y: 50, width: 1102, height: 742 }
  let actual = { ...bounds }
  const window = {
    setBounds: vi.fn((requested: typeof bounds) => {
      actual = { ...requested, width: requested.width + 2, height: requested.height + 1 }
    }),
    getBounds: () => actual
  }
  restoreWindowBounds(window as unknown as BrowserWindow, bounds)
  expect(actual).toEqual(bounds)
  expect(window.setBounds).toHaveBeenCalledTimes(2)
})
