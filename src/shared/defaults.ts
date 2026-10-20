import type { AppSettings } from './contracts'

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 10,
  appearance: {
    density: 'compact',
    fontSize: 12,
    accent: 'blue',
    cornerRadius: 6,
    motion: 'system',
    sidebarFontSize: 12,
    showServerAddress: false,
    showSessionCount: true,
    headerServer: 'alias',
    showConnectionStatus: true,
    showViewLabels: false,
    contentPadding: 24,
    messageSpacing: 24,
    composerMaxHeight: 180
  },
  profiles: [
    {
      id: 'mas',
      label: 'Example Server',
      host: 'mas',
      sshHost: 'mas',
      port: 22,
      authMode: 'key',
      defaultSession: 'claude-mas',
      defaultCwd: '/home/user/project',
      claudePath: '~/.local/bin/claude'
    }
  ],
  currentProfileId: 'mas',
  theme: 'light',
  interfaceFont: 'mona-sans',
  replyFont: 'mona-sans',
  code: { font: 'jetbrains-mono', fontSize: 13, lineHeight: 1.65 },
  language: 'zh-CN',
  terminal: {
    font: 'cascadia-mono',
    fontSize: 14,
    scrollback: 30000,
    lineHeight: 1,
    cursorStyle: 'block',
    cursorBlink: true
  },
  composer: {
    sendShortcut: 'Ctrl+Enter',
    maxCharacters: 200000,
    fontSize: 14,
    lineWrapping: true,
    historyLimit: 100,
    historyNavigation: 'arrows'
  },
  conversation: {
    widthMode: 'limited',
    maxWidth: 820,
    fontSize: 14,
    lineHeight: 1.75,
    showTimestamps: true,
    expandActivity: false,
    autoScroll: false
  },
  notifications: true,
  startMinimizedToTray: false,
  closeToTray: false,
  confirmExternalLinks: true
}

// Legacy defaults remain available for migration and explicit test fixtures.
// A new installation must never assume the developer's SSH alias exists.
export const FIRST_RUN_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  profiles: [],
  currentProfileId: ''
}
