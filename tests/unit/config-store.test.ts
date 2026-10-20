import { describe, expect, it, vi } from 'vitest'
import { ConfigStore, migrateSettings } from '../../src/main/config-store'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { AppSettingsSchema, type AppSettings } from '../../src/shared/contracts'

vi.mock('electron-store', () => ({
  default: class {
    store: AppSettings
    constructor(options: { defaults: AppSettings }) {
      this.store = structuredClone(options.defaults)
    }
  }
}))

describe('empty server configuration', () => {
  it('starts without the developer SSH profile and preserves an existing profile on update', () => {
    const store = new ConfigStore()
    expect(store.get().profiles).toEqual([])
    expect(store.get().currentProfileId).toBe('')
    expect(store.update(DEFAULT_SETTINGS).profiles).toEqual(DEFAULT_SETTINGS.profiles)
  })
  it('saves and reads an empty server list without restoring the bundled server', () => {
    const store = new ConfigStore()
    const empty = { ...DEFAULT_SETTINGS, profiles: [], currentProfileId: '' }
    expect(store.update(empty)).toEqual(empty)
    expect(store.get()).toEqual(empty)
    expect(() => store.update({ ...DEFAULT_SETTINGS, currentProfileId: 'missing' })).toThrow(
      'The selected profile does not exist'
    )
    expect(store.get()).toEqual(empty)
  })

  it('selects the first imported server after all saved servers have been deleted', () => {
    const store = new ConfigStore()
    store.update({ ...DEFAULT_SETTINGS, profiles: [], currentProfileId: '' })
    const result = store.importSshConfigEntries([{ host: 'exp' }])
    expect(result.imported).toBe(1)
    expect(store.get().currentProfileId).toBe(result.profiles[0]!.id)
    expect(store.get().profiles).toHaveLength(1)
  })
})

describe('settings migration', () => {
  it('adds compact appearance to real v9 data without changing existing preferences', () => {
    const previous: Record<string, unknown> = structuredClone(DEFAULT_SETTINGS)
    delete previous.appearance
    previous.schemaVersion = 9
    previous.code = { font: 'consolas', fontSize: 19, lineHeight: 1.9 }
    previous.theme = 'dark'
    const result = AppSettingsSchema.parse(migrateSettings(previous).value)
    expect(result).toEqual({
      ...previous,
      schemaVersion: 10,
      appearance: DEFAULT_SETTINGS.appearance
    })
    result.appearance = {
      ...result.appearance,
      density: 'comfortable',
      accent: 'teal',
      fontSize: 16
    }
    expect(migrateSettings(result)).toEqual({ value: result, changed: false })
    expect(
      AppSettingsSchema.safeParse({ ...result, appearance: { ...result.appearance, fontSize: 80 } })
        .success
    ).toBe(false)
  })
  it('adds code typography to v8 while preserving all existing choices', () => {
    const { code: _code, ...previous } = structuredClone(DEFAULT_SETTINGS)
    expect(_code).toEqual(DEFAULT_SETTINGS.code)
    const legacy = {
      ...previous,
      schemaVersion: 8,
      replyFont: 'kaiti',
      terminal: { ...previous.terminal, fontSize: 22 }
    }
    const migrated = AppSettingsSchema.parse(migrateSettings(legacy).value)
    expect(migrated).toEqual({ ...legacy, schemaVersion: 10, code: DEFAULT_SETTINGS.code })
    migrated.code = { font: 'local:Custom Mono', fontSize: 18, lineHeight: 1.8 }
    expect(migrateSettings(migrated)).toEqual({ value: migrated, changed: false })
  })
  it('defaults missing reading preferences to centered without replacing explicit choices', () => {
    const legacy = {
      ...DEFAULT_SETTINGS,
      conversation: { ...DEFAULT_SETTINGS.conversation, widthMode: undefined }
    }
    expect(AppSettingsSchema.parse(legacy).conversation.widthMode).toBe('limited')
    for (const widthMode of ['full', 'limited'] as const) {
      const saved = {
        ...DEFAULT_SETTINGS,
        conversation: { ...DEFAULT_SETTINGS.conversation, widthMode, maxWidth: 1100 }
      }
      expect(AppSettingsSchema.parse(migrateSettings(saved).value).conversation).toEqual(
        saved.conversation
      )
    }
  })

  it('migrates schema v2 appearance and terminal settings to schema v10', () => {
    const legacy = {
      ...structuredClone(DEFAULT_SETTINGS),
      schemaVersion: 2,
      terminal: {
        fontFamily: 'Consolas',
        fontSize: 14,
        scrollback: 30000
      }
    } as Record<string, unknown>
    delete legacy.theme
    delete legacy.language
    delete legacy.interfaceFont

    expect(migrateSettings(legacy)).toEqual({
      value: expect.objectContaining({
        schemaVersion: 10,
        theme: 'light',
        interfaceFont: 'mona-sans',
        replyFont: 'mona-sans',
        language: 'zh-CN',
        terminal: expect.objectContaining({ font: 'consolas' }),
        profiles: [expect.objectContaining({ sshHost: 'mas' })]
      }),
      changed: true
    })
  })

  it('maps an existing JetBrains Mono preference to its preset', () => {
    const legacy = {
      ...structuredClone(DEFAULT_SETTINGS),
      schemaVersion: 3,
      terminal: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 15,
        scrollback: 50000
      }
    } as Record<string, unknown>
    delete legacy.interfaceFont

    expect(migrateSettings(legacy)).toEqual({
      value: expect.objectContaining({
        schemaVersion: 10,
        interfaceFont: 'mona-sans',
        replyFont: 'mona-sans',
        terminal: expect.objectContaining({ font: 'jetbrains-mono', fontSize: 15 })
      }),
      changed: true
    })
  })

  it('maps legacy font preset names to real font names and preserves them for replies', () => {
    const legacy = {
      ...structuredClone(DEFAULT_SETTINGS),
      schemaVersion: 5,
      interfaceFont: 'clear-chinese'
    } as Record<string, unknown>

    expect(migrateSettings(legacy)).toEqual({
      value: expect.objectContaining({
        schemaVersion: 10,
        interfaceFont: 'yahei',
        replyFont: 'yahei'
      }),
      changed: true
    })
  })

  it('adds a reply font for schema v6 settings', () => {
    const legacy = {
      ...structuredClone(DEFAULT_SETTINGS),
      schemaVersion: 6,
      replyFont: undefined,
      interfaceFont: 'space-grotesk'
    } as Record<string, unknown>

    expect(migrateSettings(legacy)).toEqual({
      value: expect.objectContaining({
        schemaVersion: 10,
        interfaceFont: 'space-grotesk',
        replyFont: 'space-grotesk'
      }),
      changed: true
    })
  })

  it('upgrades real v7 data without replacing existing servers or preferences', () => {
    const legacy = {
      ...structuredClone(DEFAULT_SETTINGS),
      schemaVersion: 7,
      theme: 'dark',
      replyFont: 'kaiti',
      conversation: undefined,
      terminal: { font: 'consolas', fontSize: 20, scrollback: 8000 },
      composer: { sendShortcut: 'Enter', maxCharacters: 5000 }
    }
    const migrated = migrateSettings(legacy)
    const result = AppSettingsSchema.parse(migrated.value)
    expect(result).toMatchObject({
      schemaVersion: 10,
      theme: 'dark',
      replyFont: 'kaiti',
      profiles: legacy.profiles,
      terminal: {
        font: 'consolas',
        fontSize: 20,
        scrollback: 8000,
        cursorBlink: true,
        cursorStyle: 'block',
        lineHeight: 1
      },
      composer: {
        sendShortcut: 'Enter',
        maxCharacters: 5000,
        historyLimit: 100,
        historyNavigation: 'arrows'
      },
      conversation: DEFAULT_SETTINGS.conversation
    })
    expect(migrateSettings(result)).toEqual({ value: result, changed: false })
  })
})
