import { Copy, Download, FolderOpen, RefreshCw, X } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { useAppStore } from '../store'
import { SidebarRowMenu, type SidebarMenuItem } from './SidebarRowMenu'

export function RemoteFileMenu({
  target,
  path,
  directory = false,
  onOpen,
  onReveal,
  onReload,
  onClose,
  showTrigger = false,
  children,
  className = ''
}: {
  target: SessionTarget
  path: string
  directory?: boolean
  onOpen?: () => void
  onReveal?: () => void
  onReload?: () => void
  onClose?: () => void
  showTrigger?: boolean
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const { language } = useI18n()
  const label = (zh: string, en: string): string => (language === 'zh-CN' ? zh : en)
  const key = JSON.stringify([target.profileId, target.sessionName, path])
  const downloading = useSyncExternalStore(subscribeDownloads, () => downloads.has(key))
  const run = (action: () => Promise<unknown>): void => {
    void action().catch((error: unknown) =>
      useAppStore.getState().showToast({
        level: 'error',
        title: label('文件操作失败', 'File operation failed'),
        body: error instanceof Error ? error.message : String(error)
      })
    )
  }
  const items: SidebarMenuItem[] = []
  if (onOpen)
    items.push({ label: label('打开', 'Open'), icon: <FolderOpen size={15} />, run: onOpen })
  if (!directory)
    items.push({
      label: downloading
        ? label('正在下载…', 'Downloading…')
        : label('下载文件…', 'Download file…'),
      disabled: downloading,
      icon: <Download size={15} />,
      run: () =>
        run(async () => {
          if (downloads.has(key)) return
          downloads.add(key)
          notifyDownloads()
          try {
            const result = await window.claudeBridge.files.download({ ...target, path })
            if (!result.canceled)
              useAppStore.getState().showToast({
                level: 'info',
                title: label('文件已下载', 'File downloaded'),
                body: result.path ?? path
              })
          } finally {
            downloads.delete(key)
            notifyDownloads()
          }
        })
    })
  items.push(
    {
      label: label('复制路径', 'Copy path'),
      separator: true,
      icon: <Copy size={15} />,
      run: () => run(() => navigator.clipboard.writeText(path))
    },
    {
      label: label('复制名称', 'Copy name'),
      icon: <Copy size={15} />,
      run: () => run(() => navigator.clipboard.writeText(path.split('/').at(-1) ?? path))
    }
  )
  if (onReveal)
    items.push({
      label: label('在文件夹中显示', 'Show in folder'),
      icon: <FolderOpen size={15} />,
      run: onReveal
    })
  if (onReload)
    items.push({ label: label('重新读取', 'Reload'), icon: <RefreshCw size={15} />, run: onReload })
  if (onClose)
    items.push({
      label: label('关闭标签页', 'Close tab'),
      icon: <X size={15} />,
      run: onClose,
      separator: true
    })
  return (
    <SidebarRowMenu
      label={label('文件操作', 'File actions')}
      className={`remote-file-menu ${className}`}
      items={items}
      showTrigger={showTrigger}
    >
      {children}
    </SidebarRowMenu>
  )
}

// The same file can have a tab menu, browser menu and overflow menu.
const downloads = new Set<string>()
const downloadListeners = new Set<() => void>()
function subscribeDownloads(listener: () => void): () => void {
  downloadListeners.add(listener)
  return () => {
    downloadListeners.delete(listener)
  }
}
function notifyDownloads(): void {
  downloadListeners.forEach((listener) => listener())
}
