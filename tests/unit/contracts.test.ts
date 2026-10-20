import { describe, expect, it } from 'vitest'
import {
  AppSettingsSchema,
  AttachSessionRequestSchema,
  ProfileSchema,
  SshConfigContentSchema,
  WriteTerminalInputRequestSchema
} from '../../src/shared/contracts'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { SETTINGS_FIELDS, updateSetting } from '../../src/renderer/src/settings-fields'

describe('security contracts', () => {
  it('allows an empty server library only with an empty selection', () => {
    expect(
      AppSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, profiles: [], currentProfileId: '' })
        .success
    ).toBe(true)
    expect(AppSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, profiles: [] }).success).toBe(false)
    expect(AppSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, currentProfileId: '' }).success).toBe(
      false
    )
  })
  it.each(SETTINGS_FIELDS.filter((field) => field.type === 'number'))(
    'validates the UI bounds for $id in the persisted schema',
    (field) => {
      expect(
        AppSettingsSchema.safeParse(updateSetting(DEFAULT_SETTINGS, field.id, field.min!)).success
      ).toBe(true)
      expect(
        AppSettingsSchema.safeParse(updateSetting(DEFAULT_SETTINGS, field.id, field.max!)).success
      ).toBe(true)
      expect(
        AppSettingsSchema.safeParse(updateSetting(DEFAULT_SETTINGS, field.id, field.min! - 1))
          .success
      ).toBe(false)
      expect(
        AppSettingsSchema.safeParse(updateSetting(DEFAULT_SETTINGS, field.id, field.max! + 1))
          .success
      ).toBe(false)
      expect(
        AppSettingsSchema.safeParse(updateSetting(DEFAULT_SETTINGS, field.id, NaN)).success
      ).toBe(false)
    }
  )
  it('rejects shell metacharacters in tmux session names', () => {
    expect(() =>
      AttachSessionRequestSchema.parse({ profileId: 'mas', sessionName: 'ok; rm -rf x' })
    ).toThrow()
  })

  it('accepts a normal SSH profile with explicit host fields', () => {
    expect(
      ProfileSchema.parse({
        id: 'mas',
        label: 'MAS',
        host: 'mas.example.com',
        port: 22,
        user: 'ubuntu',
        authMode: 'key',
        defaultSession: 'claude-mas',
        defaultCwd: '/home/user/work',
        claudePath: '/home/user/.local/bin/claude'
      }).host
    ).toBe('mas.example.com')
  })

  it('defaults port and authMode when omitted', () => {
    const profile = ProfileSchema.parse({
      id: 'p2',
      label: 'P2',
      host: '10.0.0.5',
      defaultSession: 'claude-p2',
      defaultCwd: '/root',
      claudePath: '/usr/bin/claude'
    })
    expect(profile.port).toBe(22)
    expect(profile.authMode).toBe('key')
  })

  it('accepts a legacy sshHost alias alongside explicit host', () => {
    const profile = ProfileSchema.parse({
      id: 'legacy',
      label: 'Legacy',
      host: 'legacy.example.com',
      port: 22,
      sshHost: 'mas',
      defaultSession: 'claude-legacy',
      defaultCwd: '/root',
      claudePath: '/usr/bin/claude'
    })
    expect(profile.sshHost).toBe('mas')
  })

  it('blocks NUL in direct terminal input', () => {
    expect(() =>
      WriteTerminalInputRequestSchema.parse({
        profileId: 'mas',
        sessionName: 'claude-mas',
        data: 'a\0b'
      })
    ).toThrow()
  })

  it('allows standard OpenSSH text but rejects NUL bytes', () => {
    expect(
      SshConfigContentSchema.parse('Host mas\n  HostName 203.0.113.10\n  IdentitiesOnly yes\n')
    ).toContain('Host mas')
    expect(() => SshConfigContentSchema.parse('Host mas\0')).toThrow()
  })
})
