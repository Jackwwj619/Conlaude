import { EventEmitter } from 'node:events'
import type { ActivationArguments, BrowserWindow, NotificationConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  activation: undefined as ((details: ActivationArguments) => void) | undefined,
  instances: [] as Array<
    EventEmitter & {
      close: ReturnType<typeof vi.fn>
      show: ReturnType<typeof vi.fn>
      options: NotificationConstructorOptions
    }
  >
}))
vi.mock('electron', () => ({
  Notification: class extends EventEmitter {
    static handleActivation(callback: (details: ActivationArguments) => void): void {
      native.activation = callback
    }
    close = vi.fn()
    show = vi.fn()
    constructor(public options: NotificationConstructorOptions) {
      super()
      native.instances.push(this)
    }
  }
}))
vi.mock('../../src/main/logger', () => ({ logger: { warn: vi.fn() } }))
import { DesktopNotifications } from '../../src/main/desktop-notifications'

describe('desktop notification activation', () => {
  beforeEach(() => {
    native.instances.length = 0
    native.activation = undefined
  })

  it('restores, raises and focuses the window before selecting the notification chat', () => {
    const order: string[] = []
    const window = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: () => order.push('restore'),
      show: () => order.push('show'),
      moveTop: () => order.push('raise'),
      focus: () => order.push('focus')
    } as unknown as BrowserWindow
    const target = { profileId: 'mas', sessionName: 'review' }
    const navigate = vi.fn(() => order.push('navigate'))
    const notifications = new DesktopNotifications(() => window, navigate)
    notifications.show({ title: 'Finished' }, target)
    const notification = native.instances[0]!
    expect(notification.show).toHaveBeenCalledOnce()
    notification.emit('close')
    notification.emit('click')
    expect(order).toEqual(['restore', 'show', 'raise', 'focus', 'navigate'])
    expect(navigate).toHaveBeenCalledExactlyOnceWith(target)
  })

  it('opens generic notifications too, without changing the current chat', () => {
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      moveTop: vi.fn(),
      focus: vi.fn()
    }
    const navigate = vi.fn()
    const notifications = new DesktopNotifications(
      () => window as unknown as BrowserWindow,
      navigate
    )
    notifications.show({ title: 'Connection diagnostics' })
    native.instances[0]!.emit('click')
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(window.restore).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('retains closed banners for notification-center clicks and clears them on shutdown', () => {
    const notifications = new DesktopNotifications(() => undefined, vi.fn())
    notifications.show({ title: 'Finished' })
    const notification = native.instances[0]!
    notification.emit('close')
    notifications.closeAll()
    expect(notification.close).toHaveBeenCalledOnce()
    notifications.closeAll()
    expect(notification.close).toHaveBeenCalledOnce()
  })

  it('bounds retained notifications and safely ignores clicks after the window is destroyed', () => {
    const navigate = vi.fn()
    const notifications = new DesktopNotifications(() => undefined, navigate)
    for (let i = 0; i < 101; i++) notifications.show({ title: String(i) })
    expect(native.instances[0]!.close).toHaveBeenCalledOnce()
    expect(() => native.instances[100]!.emit('click')).not.toThrow()
    expect(navigate).not.toHaveBeenCalled()
  })

  function windowsController(): {
    notifications: DesktopNotifications
    window: { show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }
    navigate: ReturnType<typeof vi.fn>
  } {
    const window = {
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      moveTop: vi.fn(),
      focus: vi.fn()
    }
    const navigate = vi.fn()
    const notifications = new DesktopNotifications(
      () => window as unknown as BrowserWindow,
      navigate,
      'win32'
    )
    notifications.registerActivationHandler()
    return { notifications, window, navigate }
  }

  it('puts escaped text and the chat destination into Windows launch arguments', () => {
    const { notifications } = windowsController()
    const target = { profileId: 'mas', sessionName: 'review-1' }
    const title = '<Finished> & "ready"'
    const body = "server's <chat> & result"
    notifications.show({ title, body, silent: true }, target)
    const { options } = native.instances[0]!
    const xml = new DOMParser().parseFromString(options.toastXml!, 'application/xml')
    expect(xml.querySelector('parsererror')).toBeNull()
    expect([...xml.querySelectorAll('text')].map((node) => node.textContent)).toEqual([title, body])
    expect(xml.querySelector('audio')?.getAttribute('silent')).toBe('true')
    const args = new URLSearchParams(xml.documentElement.getAttribute('launch')!)
    expect(Object.fromEntries(args)).toEqual({ type: 'click', tag: options.id, ...target })
  })

  it.each(['global-first', 'instance-first'])('handles both Windows paths once (%s)', (order) => {
    const { notifications, window, navigate } = windowsController()
    const target = { profileId: 'exp', sessionName: 'review' }
    notifications.show({ title: 'Finished' }, target)
    const notification = native.instances[0]!
    const xml = new DOMParser().parseFromString(notification.options.toastXml!, 'application/xml')
    const activate = (): void =>
      native.activation!({ type: 'click', arguments: xml.documentElement.getAttribute('launch')! })
    notification.emit('close', { reason: 'timedOut' })
    if (order === 'global-first') activate()
    notification.emit('click')
    if (order === 'instance-first') activate()
    expect(window.show).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledExactlyOnceWith(target)
  })

  it('routes a notification-center activation with no live Notification instance', () => {
    const { window, navigate } = windowsController()
    native.activation!({
      type: 'click',
      arguments: 'type=click&tag=previous-notification&profileId=mas&sessionName=review'
    })
    expect(window.focus).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ profileId: 'mas', sessionName: 'review' })
  })

  it('focuses legacy or malformed notifications without navigating to an invalid target', () => {
    const { window, navigate } = windowsController()
    native.activation!({ type: 'click', arguments: '' })
    native.activation!({ type: 'click', arguments: 'profileId=mas&sessionName=../../invalid' })
    expect(window.focus).toHaveBeenCalledTimes(2)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores non-click activations and activations arriving during shutdown', () => {
    const { notifications, window } = windowsController()
    native.activation!({ type: 'reply', arguments: '', reply: 'text' })
    notifications.closeAll()
    native.activation!({ type: 'click', arguments: '' })
    expect(window.show).not.toHaveBeenCalled()
  })

  it('keeps the native notification format on other platforms', () => {
    const notifications = new DesktopNotifications(() => undefined, vi.fn(), 'darwin')
    notifications.registerActivationHandler()
    notifications.show({ title: 'Finished' })
    expect(native.activation).toBeUndefined()
    expect(native.instances[0]!.options.toastXml).toBeUndefined()
  })
})
