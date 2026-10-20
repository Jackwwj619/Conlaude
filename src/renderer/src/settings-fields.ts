import type { AppSettings } from '../../shared/contracts'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { INTERFACE_FONT_OPTIONS, TERMINAL_FONT_OPTIONS } from '../../shared/font-presets'

export type SettingsCategory =
  'general' | 'appearance' | 'conversation' | 'composer' | 'navigation' | 'connection'
type PreferenceGroup = 'terminal' | 'composer' | 'conversation' | 'code' | 'appearance'
type SimplePreference = Exclude<
  keyof AppSettings,
  PreferenceGroup | 'schemaVersion' | 'profiles' | 'currentProfileId'
>
export type SettingPath =
  | SimplePreference
  | {
      [K in PreferenceGroup]: `${K}.${keyof AppSettings[K] & string}`
    }[PreferenceGroup]

export interface SettingField {
  id: SettingPath
  category: SettingsCategory
  section: string
  label: string
  hint?: string
  type: 'select' | 'number' | 'checkbox'
  options?: ReadonlyArray<{ value: string; labelKey: string }>
  min?: number
  max?: number
  step?: number
}

// A single catalog drives rendering, search, validation labels and category reset.
export const SETTINGS_FIELDS: SettingField[] = [
  {
    id: 'appearance.density',
    category: 'appearance',
    section: 'layout',
    label: 'settings.density',
    type: 'select',
    options: [
      { value: 'compact', labelKey: 'settings.densityCompact' },
      { value: 'comfortable', labelKey: 'settings.densityComfortable' }
    ]
  },
  {
    id: 'appearance.fontSize',
    category: 'appearance',
    section: 'interface',
    label: 'settings.uiFontSize',
    type: 'number',
    min: 11,
    max: 16
  },
  {
    id: 'appearance.accent',
    category: 'appearance',
    section: 'theme',
    label: 'settings.accent',
    type: 'select',
    options: [
      { value: 'graphite', labelKey: 'settings.accentGraphite' },
      { value: 'blue', labelKey: 'settings.accentBlue' },
      { value: 'teal', labelKey: 'settings.accentTeal' },
      { value: 'violet', labelKey: 'settings.accentViolet' }
    ]
  },
  {
    id: 'appearance.cornerRadius',
    category: 'appearance',
    section: 'layout',
    label: 'settings.cornerRadius',
    type: 'number',
    min: 0,
    max: 16
  },
  {
    id: 'appearance.motion',
    category: 'appearance',
    section: 'layout',
    label: 'settings.motion',
    type: 'select',
    options: [
      { value: 'system', labelKey: 'settings.motionSystem' },
      { value: 'reduced', labelKey: 'settings.motionReduced' }
    ]
  },
  {
    id: 'appearance.contentPadding',
    category: 'appearance',
    section: 'layout',
    label: 'settings.contentPadding',
    type: 'number',
    min: 12,
    max: 48
  },
  {
    id: 'appearance.sidebarFontSize',
    category: 'navigation',
    section: 'sidebar',
    label: 'settings.sidebarFontSize',
    type: 'number',
    min: 11,
    max: 16
  },
  {
    id: 'appearance.showServerAddress',
    category: 'navigation',
    section: 'sidebar',
    label: 'settings.showServerAddress',
    hint: 'settings.showServerAddressHint',
    type: 'checkbox'
  },
  {
    id: 'appearance.showSessionCount',
    category: 'navigation',
    section: 'sidebar',
    label: 'settings.showSessionCount',
    type: 'checkbox'
  },
  {
    id: 'appearance.headerServer',
    category: 'navigation',
    section: 'header',
    label: 'settings.headerServer',
    type: 'select',
    options: [
      { value: 'alias', labelKey: 'settings.headerAlias' },
      { value: 'label', labelKey: 'settings.headerLabel' },
      { value: 'hidden', labelKey: 'settings.headerHidden' }
    ]
  },
  {
    id: 'appearance.showConnectionStatus',
    category: 'navigation',
    section: 'header',
    label: 'settings.showConnectionStatus',
    type: 'checkbox'
  },
  {
    id: 'appearance.showViewLabels',
    category: 'navigation',
    section: 'header',
    label: 'settings.showViewLabels',
    hint: 'settings.showViewLabelsHint',
    type: 'checkbox'
  },
  {
    id: 'appearance.messageSpacing',
    category: 'conversation',
    section: 'messages',
    label: 'settings.messageSpacing',
    type: 'number',
    min: 12,
    max: 48
  },
  {
    id: 'appearance.composerMaxHeight',
    category: 'composer',
    section: 'editor',
    label: 'settings.composerMaxHeight',
    hint: 'settings.composerMaxHeightHint',
    type: 'number',
    min: 100,
    max: 360
  },
  {
    id: 'code.font',
    category: 'appearance',
    section: 'code',
    label: 'settings.codeFont',
    type: 'select',
    options: TERMINAL_FONT_OPTIONS
  },
  {
    id: 'code.fontSize',
    category: 'appearance',
    section: 'code',
    label: 'settings.codeFontSize',
    type: 'number',
    min: 10,
    max: 28
  },
  {
    id: 'code.lineHeight',
    category: 'appearance',
    section: 'code',
    label: 'settings.codeLineHeight',
    type: 'number',
    min: 1,
    max: 2.2,
    step: 0.05
  },
  {
    id: 'conversation.widthMode',
    category: 'conversation',
    section: 'messages',
    label: 'settings.conversationWidth',
    type: 'select',
    options: [
      { value: 'full', labelKey: 'settings.widthFull' },
      { value: 'limited', labelKey: 'settings.widthLimited' }
    ]
  },
  {
    id: 'conversation.maxWidth',
    category: 'conversation',
    section: 'messages',
    label: 'settings.maxReadingWidth',
    hint: 'settings.maxReadingWidthHint',
    type: 'number',
    min: 560,
    max: 1600
  },
  {
    id: 'language',
    category: 'general',
    section: 'application',
    label: 'settings.language',
    type: 'select',
    options: [
      { value: 'zh-CN', labelKey: 'settings.languageZh' },
      { value: 'en-US', labelKey: 'settings.languageEn' }
    ]
  },
  {
    id: 'startMinimizedToTray',
    category: 'general',
    section: 'window',
    label: 'settings.startMinimized',
    hint: 'settings.restartHint',
    type: 'checkbox'
  },
  {
    id: 'closeToTray',
    category: 'general',
    section: 'window',
    label: 'settings.closeToTray',
    type: 'checkbox'
  },
  {
    id: 'notifications',
    category: 'general',
    section: 'notifications',
    label: 'settings.notifications',
    type: 'checkbox'
  },
  {
    id: 'confirmExternalLinks',
    category: 'general',
    section: 'notifications',
    label: 'settings.confirmLinks',
    type: 'checkbox'
  },
  {
    id: 'theme',
    category: 'appearance',
    section: 'theme',
    label: 'settings.theme',
    type: 'select',
    options: [
      { value: 'light', labelKey: 'settings.themeLight' },
      { value: 'dark', labelKey: 'settings.themeDark' },
      { value: 'system', labelKey: 'settings.themeSystem' }
    ]
  },
  {
    id: 'interfaceFont',
    category: 'appearance',
    section: 'interface',
    label: 'settings.interfaceFont',
    type: 'select',
    options: INTERFACE_FONT_OPTIONS
  },
  {
    id: 'replyFont',
    category: 'appearance',
    section: 'reading',
    label: 'settings.replyFont',
    type: 'select',
    options: INTERFACE_FONT_OPTIONS
  },
  {
    id: 'conversation.fontSize',
    category: 'appearance',
    section: 'reading',
    label: 'settings.replyFontSize',
    type: 'number',
    min: 12,
    max: 24
  },
  {
    id: 'conversation.lineHeight',
    category: 'appearance',
    section: 'reading',
    label: 'settings.replyLineHeight',
    type: 'number',
    min: 1.3,
    max: 2.2,
    step: 0.05
  },
  {
    id: 'conversation.showTimestamps',
    category: 'conversation',
    section: 'messages',
    label: 'settings.showTimestamps',
    type: 'checkbox'
  },
  {
    id: 'conversation.expandActivity',
    category: 'conversation',
    section: 'messages',
    label: 'settings.expandActivity',
    hint: 'settings.expandActivityHint',
    type: 'checkbox'
  },
  {
    id: 'conversation.autoScroll',
    category: 'conversation',
    section: 'messages',
    label: 'settings.autoScroll',
    hint: 'settings.autoScrollHint',
    type: 'checkbox'
  },
  {
    id: 'composer.sendShortcut',
    category: 'composer',
    section: 'sending',
    label: 'settings.sendShortcut',
    type: 'select',
    options: [
      { value: 'Ctrl+Enter', labelKey: 'settings.sendShortcutCtrlEnter' },
      { value: 'Enter', labelKey: 'settings.sendShortcutEnter' }
    ]
  },
  {
    id: 'composer.maxCharacters',
    category: 'composer',
    section: 'sending',
    label: 'settings.maxCharacters',
    hint: 'settings.maxCharactersHint',
    type: 'number',
    min: 1000,
    max: 1000000
  },
  {
    id: 'composer.fontSize',
    category: 'composer',
    section: 'editor',
    label: 'settings.composerFontSize',
    type: 'number',
    min: 12,
    max: 24
  },
  {
    id: 'composer.lineWrapping',
    category: 'composer',
    section: 'editor',
    label: 'settings.lineWrapping',
    type: 'checkbox'
  },
  {
    id: 'composer.historyNavigation',
    category: 'composer',
    section: 'history',
    label: 'settings.historyNavigation',
    type: 'select',
    options: [
      { value: 'arrows', labelKey: 'settings.historyArrows' },
      { value: 'alt-arrows', labelKey: 'settings.historyAltArrows' },
      { value: 'off', labelKey: 'settings.historyOff' }
    ]
  },
  {
    id: 'composer.historyLimit',
    category: 'composer',
    section: 'history',
    label: 'settings.historyLimit',
    hint: 'settings.historyLimitHint',
    type: 'number',
    min: 0,
    max: 500
  },
  {
    id: 'terminal.font',
    category: 'appearance',
    section: 'terminalText',
    label: 'settings.font',
    type: 'select',
    options: TERMINAL_FONT_OPTIONS
  },
  {
    id: 'terminal.fontSize',
    category: 'appearance',
    section: 'terminalText',
    label: 'settings.fontSize',
    type: 'number',
    min: 10,
    max: 28
  },
  {
    id: 'terminal.lineHeight',
    category: 'appearance',
    section: 'terminalText',
    label: 'settings.terminalLineHeight',
    type: 'number',
    min: 1,
    max: 2,
    step: 0.05
  },
  {
    id: 'terminal.cursorStyle',
    category: 'appearance',
    section: 'cursor',
    label: 'settings.cursorStyle',
    type: 'select',
    options: [
      { value: 'block', labelKey: 'settings.cursorBlock' },
      { value: 'bar', labelKey: 'settings.cursorBar' },
      { value: 'underline', labelKey: 'settings.cursorUnderline' }
    ]
  },
  {
    id: 'terminal.cursorBlink',
    category: 'appearance',
    section: 'cursor',
    label: 'settings.cursorBlink',
    type: 'checkbox'
  },
  {
    id: 'terminal.scrollback',
    category: 'appearance',
    section: 'buffer',
    label: 'settings.scrollback',
    hint: 'settings.scrollbackHint',
    type: 'number',
    min: 1000,
    max: 100000
  }
]

export function settingValue(settings: AppSettings, path: SettingPath): string | number | boolean {
  const [group, key] = path.split('.')
  if (!key) return settings[group as SimplePreference]
  return (
    settings[group as PreferenceGroup] as unknown as Record<string, string | number | boolean>
  )[key]!
}

export function updateSetting(
  settings: AppSettings,
  path: SettingPath,
  value: string | number | boolean
): AppSettings {
  const [group, key] = path.split('.')
  return key
    ? { ...settings, [group!]: { ...settings[group as PreferenceGroup], [key]: value } }
    : { ...settings, [group!]: value }
}

export function resetSettingsCategory(
  settings: AppSettings,
  category: SettingsCategory
): AppSettings {
  return SETTINGS_FIELDS.filter((field) => field.category === category).reduce(
    (draft, field) => updateSetting(draft, field.id, settingValue(DEFAULT_SETTINGS, field.id)),
    settings
  )
}
