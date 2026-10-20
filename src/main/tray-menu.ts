import type { MenuItemConstructorOptions } from 'electron'
import type { AppAction, AppLanguage } from '../shared/contracts'
import { translate } from '../shared/i18n'

export function trayMenu({
  language,
  hasProfiles,
  show,
  hide,
  open,
  quit
}: {
  language: AppLanguage
  hasProfiles: boolean
  show: () => void
  hide: () => void
  open: (action: AppAction) => void
  quit: () => void
}): MenuItemConstructorOptions[] {
  const zh = language === 'zh-CN'
  return [
    { id: 'show', label: translate(language, 'main.trayShow'), click: show },
    { id: 'hide', label: zh ? '隐藏窗口' : 'Hide window', click: hide },
    { type: 'separator' },
    { id: 'new-chat', label: zh ? '新建聊天' : 'New chat', click: () => open('new-chat') },
    { id: 'servers', label: zh ? '服务器' : 'Servers', click: () => open('servers') },
    { id: 'settings', label: zh ? '设置' : 'Settings', click: () => open('settings') },
    {
      id: 'diagnostics',
      label: zh ? '连接诊断' : 'Connection diagnostics',
      enabled: hasProfiles,
      click: () => open('diagnostics')
    },
    { type: 'separator' },
    { id: 'exit', label: 'Exit', click: quit }
  ]
}
