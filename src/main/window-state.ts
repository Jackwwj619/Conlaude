import { screen, type BrowserWindow, type Rectangle } from 'electron'
import Store from 'electron-store'
import { z } from 'zod'
import { logger } from './logger'

const WindowStateSchema = z.object({
  bounds: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }),
  maximized: z.boolean()
})
type WindowState = z.infer<typeof WindowStateSchema>

/** Keep a restored window reachable after a monitor or display scale changes. */
export function fitWindowBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(Math.max(980, bounds.width), area.width)
  const height = Math.min(Math.max(680, bounds.height), area.height)
  return {
    width,
    height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))
  }
}

export function restoreWindowBounds(window: BrowserWindow, bounds: Rectangle): void {
  const requested = { ...bounds }
  const keys = ['x', 'y', 'width', 'height'] as const
  // Windows' fractional DPI and hidden title bar can add a few pixels to setBounds.
  // Correct against the actual outer bounds so each restart cannot grow the window.
  for (let attempt = 0; attempt < 4; attempt++) {
    window.setBounds(requested)
    const actual = window.getBounds()
    if (keys.every((key) => actual[key] === bounds[key])) break
    for (const key of keys) requested[key] += bounds[key] - actual[key]
  }
}

export function createWindowState(): {
  bounds: Rectangle
  maximized: boolean
  track: (window: BrowserWindow) => void
} {
  const storage = new Store<{ window?: WindowState }>({ name: 'window-state' })
  const saved = WindowStateSchema.safeParse(storage.get('window'))
  const area = saved.success
    ? screen.getDisplayMatching(saved.data.bounds).workArea
    : screen.getPrimaryDisplay().workArea
  const bounds = fitWindowBounds(
    saved.success
      ? saved.data.bounds
      : {
          width: 1440,
          height: 920,
          x: area.x + Math.round((area.width - 1440) / 2),
          y: area.y + Math.round((area.height - 920) / 2)
        },
    area
  )
  let state: WindowState = { bounds, maximized: saved.success && saved.data.maximized }
  return {
    ...state,
    track(window) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const save = (): void => {
        clearTimeout(timer)
        if (window.isDestroyed()) return
        // Minimized bounds can be offscreen. Keep the last usable normal bounds.
        if (!window.isMinimized() && !window.isFullScreen())
          state = { ...state, bounds: window.getNormalBounds() }
        try {
          storage.set('window', state)
        } catch (error) {
          logger.warn(`Unable to save window size: ${String(error)}`)
        }
      }
      const schedule = (): void => {
        clearTimeout(timer)
        timer = setTimeout(save, 250)
      }
      window.on('resize', schedule)
      window.on('move', schedule)
      window.on('maximize', () => {
        state.maximized = true
        schedule()
      })
      window.on('unmaximize', () => {
        state.maximized = false
        schedule()
      })
      window.on('close', save)
      window.on('closed', () => clearTimeout(timer))
    }
  }
}
