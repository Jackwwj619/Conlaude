import { randomUUID } from 'node:crypto'
import { Notification, type BrowserWindow, type NotificationConstructorOptions } from 'electron'
import { SessionTargetSchema, type SessionTarget } from '../shared/contracts'
import { logger } from './logger'

type NoticeOptions = Pick<NotificationConstructorOptions, 'title' | 'body' | 'silent'>

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character]!
  })
}

function windowsToast(options: NoticeOptions, id: string, target?: SessionTarget): string {
  // Electron's default toast has no launch arguments. Action Center can use the
  // COM activator instead of the in-process click event, so include the routing
  // information in the toast itself, independent of the Notification object.
  const launch = new URLSearchParams({ type: 'click', tag: id, ...target })
  return `<toast launch="${escapeXml(launch.toString())}" activationType="foreground"><visual><binding template="ToastGeneric"><text>${escapeXml(options.title ?? '')}</text><text>${escapeXml(options.body ?? '')}</text></binding></visual>${options.silent ? '<audio silent="true"/>' : ''}</toast>`
}

/** Keep callbacks alive while Windows retains notifications in its notification center. */
export class DesktopNotifications {
  private readonly active = new Map<string, Notification>()
  private readonly activated = new Set<string>()
  private closed = false

  constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly focusSession: (target: SessionTarget) => void,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  registerActivationHandler(): void {
    if (this.platform !== 'win32') return
    Notification.handleActivation((details) => {
      if (details.type !== 'click') return
      const args = new URLSearchParams(details.arguments)
      const target = SessionTargetSchema.safeParse({
        profileId: args.get('profileId'),
        sessionName: args.get('sessionName')
      })
      this.activate(args.get('tag') ?? undefined, target.success ? target.data : undefined)
    })
  }

  show(options: NoticeOptions, target?: SessionTarget): void {
    if (this.closed) return
    const id = randomUUID()
    const notification = new Notification({
      ...options,
      id,
      ...(this.platform === 'win32' ? { toastXml: windowsToast(options, id, target) } : {})
    })
    this.active.set(id, notification)
    notification.once('click', () => this.activate(id, target))
    notification.once('failed', (_event, error) => {
      this.active.delete(id)
      logger.warn(`Desktop notification failed: ${error}`)
    })
    // A banner closing need not mean it has left Windows notification center.
    // Retain it until activation, failure, eviction or application shutdown.
    if (this.active.size > 100) {
      const [oldestId, oldest] = this.active.entries().next().value!
      this.active.delete(oldestId)
      oldest.close()
    }
    notification.show()
  }

  private activate(id?: string, target?: SessionTarget): void {
    if (this.closed || (id && this.activated.has(id))) return
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return
    if (id) {
      // Windows may invoke both the application callback and the instance event.
      this.activated.add(id)
      this.active.delete(id)
      if (this.activated.size > 100) this.activated.delete(this.activated.values().next().value!)
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.moveTop()
    window.focus()
    if (target) this.focusSession(target)
  }

  closeAll(): void {
    this.closed = true
    for (const notification of this.active.values()) notification.close()
    this.active.clear()
    this.activated.clear()
  }
}
