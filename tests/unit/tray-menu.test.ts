import { describe, expect, it, vi } from 'vitest'
import { trayMenu } from '../../src/main/tray-menu'

describe('tray shortcuts', () => {
  it('routes each shortcut and exposes a plain Exit action in both languages', () => {
    for (const language of ['zh-CN', 'en-US'] as const) {
      const actions = { show: vi.fn(), hide: vi.fn(), open: vi.fn(), quit: vi.fn() }
      const menu = trayMenu({ language, hasProfiles: true, ...actions })
      expect(menu.filter((item) => item.type !== 'separator')).toHaveLength(7)
      for (const id of ['show', 'hide', 'new-chat', 'servers', 'settings', 'diagnostics', 'exit']) {
        const item = menu.find((item) => item.id === id)!
        ;(item.click as () => void)()
      }
      expect(actions.show).toHaveBeenCalledOnce()
      expect(actions.hide).toHaveBeenCalledOnce()
      expect(actions.open.mock.calls).toEqual([
        ['new-chat'],
        ['servers'],
        ['settings'],
        ['diagnostics']
      ])
      expect(actions.quit).toHaveBeenCalledOnce()
      expect(menu.at(-1)?.label).toBe('Exit')
    }
  })

  it('keeps setup available on a fresh installation and disables diagnostics without servers', () => {
    const menu = trayMenu({
      language: 'zh-CN',
      hasProfiles: false,
      show: vi.fn(),
      hide: vi.fn(),
      open: vi.fn(),
      quit: vi.fn()
    })
    expect(menu.find((item) => item.id === 'diagnostics')?.enabled).toBe(false)
    expect(menu.find((item) => item.id === 'new-chat')?.enabled).not.toBe(false)
  })
})
