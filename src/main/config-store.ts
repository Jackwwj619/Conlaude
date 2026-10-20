import Store from 'electron-store'
import {
  AppSettingsSchema,
  MAX_PROFILES,
  type AppSettings,
  type Profile,
  type SshConfigEntry,
  type SshConfigImportResult
} from '../shared/contracts'
import { DEFAULT_SETTINGS, FIRST_RUN_SETTINGS } from '../shared/defaults'
import { InterfaceFontSchema, terminalFontFromLegacyFamily } from '../shared/font-presets'
import { logger } from './logger'

const CURRENT_SCHEMA_VERSION = 10

function migrateV1Profile(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.sshHost === 'string' && typeof raw.host !== 'string') {
    return {
      ...raw,
      host: raw.sshHost,
      port: 22,
      authMode: 'key'
    }
  }
  return raw
}

function migrateV3Terminal(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const { fontFamily, ...terminal } = raw as Record<string, unknown>
  return { ...terminal, font: terminalFontFromLegacyFamily(fontFamily) }
}

function migrateV4Profile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const profile = raw as Record<string, unknown>
  // The bundled MAS profile has always used the local OpenSSH alias. Preserve its
  // existing behavior while allowing custom profiles to stay on explicit settings.
  if (profile.id === 'mas' && profile.host === 'mas' && typeof profile.sshHost !== 'string') {
    return { ...profile, sshHost: 'mas' }
  }
  return profile
}

export function migrateSettings(raw: unknown): { value: unknown; changed: boolean } {
  if (!raw || typeof raw !== 'object') return { value: raw, changed: false }

  let value = raw as Record<string, unknown>
  let changed = false
  if (value.schemaVersion === 1) {
    const profiles = Array.isArray(value.profiles) ? value.profiles.map(migrateV1Profile) : []
    value = { ...value, schemaVersion: 2, profiles }
    changed = true
  }
  if (value.schemaVersion === 2) {
    value = {
      ...value,
      schemaVersion: 3,
      theme: 'light',
      language: 'zh-CN'
    }
    changed = true
  }
  if (value.schemaVersion === 3) {
    value = {
      ...value,
      schemaVersion: 4,
      interfaceFont: 'system',
      terminal: migrateV3Terminal(value.terminal)
    }
    changed = true
  }
  if (value.schemaVersion === 4) {
    value = {
      ...value,
      schemaVersion: 5,
      profiles: Array.isArray(value.profiles) ? value.profiles.map(migrateV4Profile) : []
    }
    changed = true
  }
  if (value.schemaVersion === 5) {
    // Font settings switched from fuzzy preset names to real font names.
    // v3 set every install to 'system' without asking, so adopt the bundled
    // Mona Sans preset to make the redesign visible; explicit non-system
    // choices map to their renamed equivalents.
    const legacyInterfaceFonts: Record<string, string> = {
      system: 'mona-sans',
      modern: 'mona-sans',
      'clear-chinese': 'yahei'
    }
    const legacyFont = typeof value.interfaceFont === 'string' ? value.interfaceFont : 'system'
    value = {
      ...value,
      schemaVersion: 6,
      interfaceFont: legacyInterfaceFonts[legacyFont] ?? legacyFont
    }
    changed = true
  }
  if (value.schemaVersion === 6) {
    // Keep existing installations visually consistent while giving reply Markdown
    // its own preference. Invalid legacy data will be rejected by the final schema
    // validation, so use a safe bundled fallback here.
    const interfaceFont = InterfaceFontSchema.safeParse(value.interfaceFont)
    value = {
      ...value,
      schemaVersion: 7,
      replyFont: interfaceFont.success ? interfaceFont.data : 'mona-sans'
    }
    changed = true
  }
  if (value.schemaVersion === 7) {
    value = {
      ...value,
      schemaVersion: 8,
      conversation: { ...DEFAULT_SETTINGS.conversation },
      terminal: {
        ...DEFAULT_SETTINGS.terminal,
        ...(value.terminal as Record<string, unknown>)
      },
      composer: {
        ...DEFAULT_SETTINGS.composer,
        ...(value.composer as Record<string, unknown>)
      }
    }
    changed = true
  }
  if (value.schemaVersion === 8) {
    value = { ...value, schemaVersion: 9, code: { ...DEFAULT_SETTINGS.code } }
    changed = true
  }
  if (value.schemaVersion === 9) {
    value = {
      ...value,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appearance: { ...DEFAULT_SETTINGS.appearance }
    }
    changed = true
  }
  return { value, changed }
}

function slugify(label: string, existing: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'host'
  let candidate = base
  let n = 2
  while (existing.has(candidate)) candidate = `${base}-${n++}`
  existing.add(candidate)
  return candidate
}

export class ConfigStore {
  private readonly store = new Store<AppSettings>({
    name: 'config',
    defaults: FIRST_RUN_SETTINGS
  })

  get(): AppSettings {
    const raw = this.store.store
    const migrated = migrateSettings(raw)
    const parsed = AppSettingsSchema.safeParse(migrated.value)
    if (parsed.success) {
      if (migrated.changed) {
        this.store.store = parsed.data as AppSettings
      }
      return parsed.data
    }

    logger.error('Settings validation failed; safe defaults are being used', parsed.error)
    return structuredClone(FIRST_RUN_SETTINGS)
  }

  update(nextValue: unknown): AppSettings {
    const next = AppSettingsSchema.parse(nextValue)
    const profileExists = next.profiles.some((profile) => profile.id === next.currentProfileId)
    if (!profileExists && (next.profiles.length > 0 || next.currentProfileId !== ''))
      throw new Error('The selected profile does not exist')

    this.store.store = next
    return this.get()
  }

  profile(profileId: string): Profile {
    const profile = this.get().profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new Error(`Unknown profile: ${profileId}`)
    return profile
  }

  path(): string {
    return this.store.path
  }

  importSshConfigEntries(entries: SshConfigEntry[]): SshConfigImportResult {
    const current = this.get()
    const existingIds = new Set(current.profiles.map((p) => p.id))
    const imported: SshConfigImportResult['profiles'] = []
    const skipped: string[] = []

    for (const entry of entries) {
      if (
        current.profiles.length >= MAX_PROFILES ||
        entry.host === '*' ||
        entry.host.includes('?') ||
        entry.host.includes(' ') ||
        current.profiles.some((profile) => profile.sshHost === entry.host)
      ) {
        skipped.push(entry.host)
        continue
      }
      const id = slugify(entry.host, existingIds)
      const profile: Profile = {
        id,
        label: entry.host,
        // Keep the Host alias intact. ssh.exe then resolves HostName, User,
        // IdentityFile, IdentitiesOnly, Port, ProxyJump, and Includes itself.
        host: entry.host,
        sshHost: entry.host,
        port: 22,
        authMode: 'key',
        defaultSession: `claude-${id}`.slice(0, 64),
        defaultCwd: '~',
        claudePath: '~/.local/bin/claude'
      }
      current.profiles.push(profile)
      if (!current.currentProfileId) current.currentProfileId = profile.id
      imported.push({ id: profile.id, label: profile.label, host: profile.host })
    }

    if (imported.length > 0) this.update(current)
    return { imported: imported.length, profiles: imported, skipped }
  }
}
