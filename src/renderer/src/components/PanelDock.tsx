import { useRef, type ReactNode } from 'react'
import { FolderOpen, SquareTerminal, Maximize2, Minimize2, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { useLayoutPreferences } from '../layout-preferences'

/** The header, boundary and width belong to the dock, not to its active tool. */
export function PanelDock({
  maximized,
  onMaximize,
  rightOpen,
  bottomOpen,
  active,
  onFiles,
  onTerminal,
  onClose,
  children
}: {
  maximized: boolean
  onMaximize: () => void
  rightOpen: boolean
  bottomOpen: boolean
  active: 'files' | 'terminal'
  onFiles: () => void
  onTerminal: () => void
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const root = useRef<HTMLDivElement>(null)
  const pointer = useRef<number | undefined>(undefined)
  const width = useLayoutPreferences((s) => s.filesWidth)
  const resize = (next: number): void => {
    const available = root.current?.closest('.dock-layout')?.clientWidth ?? innerWidth
    useLayoutPreferences
      .getState()
      .update({ filesWidth: Math.round(Math.max(300, Math.min(next, available - 280))) })
  }
  return (
    <div
      ref={root}
      className="panel-dock"
      data-bottom={bottomOpen}
      hidden={!rightOpen && !bottomOpen}
    >
      <div
        className="panel-dock-sizer"
        hidden={!rightOpen}
        role="separator"
        tabIndex={0}
        aria-label={zh ? '调整右侧栏宽度' : 'Resize right sidebar'}
        aria-orientation="vertical"
        aria-valuemin={300}
        aria-valuenow={width ?? 500}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          pointer.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return
          const bounds = root.current!.closest('.dock-layout')!.getBoundingClientRect()
          resize(bounds.right - event.clientX)
        }}
        onPointerUp={(event) => {
          pointer.current = undefined
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onLostPointerCapture={() => {
          pointer.current = undefined
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
          event.preventDefault()
          const currentWidth =
            root.current?.getBoundingClientRect().width ||
            (root.current
              ?.querySelector('#remote-files-panel .panel-dock-header')
              ?.getBoundingClientRect().width ?? 0) + 36
          resize(event.key === 'Home' ? 340 : currentWidth + (event.key === 'ArrowLeft' ? 24 : -24))
        }}
      />
      <div
        className="panel-tool-rail"
        hidden={!rightOpen}
        role="toolbar"
        aria-label={zh ? '侧栏工具' : 'Sidebar tools'}
      >
        <button
          className="icon-button"
          aria-label={zh ? '文件' : 'Files'}
          title={zh ? '文件' : 'Files'}
          aria-pressed={active === 'files'}
          aria-expanded={active === 'files' && rightOpen}
          aria-controls="right-panel-content"
          onClick={onFiles}
        >
          <FolderOpen size={18} />
        </button>
        <button
          className="icon-button"
          aria-label={zh ? '终端' : 'Terminal'}
          title={zh ? '终端' : 'Terminal'}
          aria-pressed={active === 'terminal'}
          aria-expanded={active === 'terminal' && rightOpen}
          aria-controls="right-panel-content"
          onClick={onTerminal}
        >
          <SquareTerminal size={18} />
        </button>
        <button
          className="icon-button panel-maximize"
          onClick={onMaximize}
          aria-label={
            zh
              ? maximized
                ? '还原右侧栏'
                : '全屏右侧栏'
              : maximized
                ? 'Restore right sidebar'
                : 'Maximize right sidebar'
          }
          title={
            zh
              ? maximized
                ? '还原右侧栏'
                : '全屏右侧栏'
              : maximized
                ? 'Restore right sidebar'
                : 'Maximize right sidebar'
          }
        >
          {maximized ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
        <button
          className="icon-button panel-dock-close"
          onClick={onClose}
          aria-label={zh ? '关闭右侧栏' : 'Close right sidebar'}
          title={zh ? '关闭右侧栏' : 'Close right sidebar'}
        >
          <X size={16} />
        </button>
      </div>
      <div className="panel-dock-body" id="right-panel-content">
        {children}
      </div>
    </div>
  )
}
