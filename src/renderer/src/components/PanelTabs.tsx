import { useEffect, useRef } from 'react'
import { FileText, X } from 'lucide-react'
import { useI18n } from '../i18n'
import type { SessionTarget } from '../../../shared/contracts'
import { RemoteFileMenu } from './RemoteFileMenu'

export interface FileTab {
  id: number
  path?: string
  server?: string
  target: SessionTarget
  dirty: boolean
}

export function PanelTabs({
  active,
  files,
  activeFileId,
  onSelectFile,
  onCloseFile,
  onRevealFile,
  onReloadFile
}: {
  active: 'files' | 'terminal'
  files: FileTab[]
  activeFileId?: number
  onSelectFile: (id: number) => void
  onCloseFile: (id: number) => void
  onRevealFile: (id: number) => void
  onReloadFile?: (id: number) => void
}): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const tabs = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = tabs.current
    if (!element) return
    const reveal = (): void => {
      if (!element.clientWidth) return
      element
        .querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(element)
    return () => observer.disconnect()
  }, [activeFileId, active])
  return (
    <div
      ref={tabs}
      className="dock-tabs"
      role="tablist"
      aria-label={zh ? '文件标签页' : 'File tabs'}
      onWheel={(event) => {
        if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) {
          event.currentTarget.scrollLeft += event.deltaY || event.deltaX
        }
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab')
          return
        event.preventDefault()
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        )
        const index = tabs.indexOf(event.target as HTMLButtonElement)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        tabs[next]?.click()
        tabs[next]?.focus()
        tabs[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }}
    >
      {files
        .filter((file) => file.path)
        .map((file) => {
          const selected = active === 'files' && file.id === activeFileId
          const name = file.path?.split('/').at(-1) ?? (zh ? '文件' : 'Files')
          return (
            <div
              className="dock-document-tab"
              key={file.id}
              data-selected={selected}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  onCloseFile(file.id)
                }
              }}
            >
              <RemoteFileMenu
                target={file.target}
                path={file.path!}
                onReveal={() => onRevealFile(file.id)}
                onReload={onReloadFile ? () => onReloadFile(file.id) : undefined}
                onClose={() => onCloseFile(file.id)}
              >
                <button
                  type="button"
                  role="tab"
                  data-panel="files"
                  id={`file-tab-${file.id}`}
                  aria-label={name}
                  title={[file.server, file.path].filter(Boolean).join(' · ')}
                  aria-selected={selected}
                  aria-controls={`file-editor-${file.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelectFile(file.id)}
                >
                  <FileText size={14} />
                  <span>{name}</span>
                  {file.dirty && (
                    <span className="remote-file-dirty" aria-label={zh ? '未保存' : 'Unsaved'} />
                  )}
                </button>
              </RemoteFileMenu>
              <button
                type="button"
                className="dock-document-close"
                aria-label={`${zh ? '关闭' : 'Close'} ${name}`}
                title={`${zh ? '关闭' : 'Close'} ${name}`}
                onClick={() => onCloseFile(file.id)}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
    </div>
  )
}
