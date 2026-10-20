import { PanelRight } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import { useI18n } from '../i18n'
import { targetKey, useAppStore } from '../store'
import { remoteParent } from '../file-navigation'
import { useLayoutPreferences } from '../layout-preferences'
import { PanelTabs } from './PanelTabs'
import { RemoteFileMenu } from './RemoteFileMenu'
import { RemoteDirectoryBrowser, type DirectoryLocation } from './RemoteDirectoryBrowser'
import RemoteFilesPanel, { type FilePanelActions } from './RemoteFilesPanel'
import '../remote-files.css'

export interface FileDocument {
  id: number
  file?: string
  target: SessionTarget
  server: string
  path: string
  dirty: boolean
  actions: RefObject<FilePanelActions | null>
}

export default function FileWorkspace({
  files,
  activeFileId,
  openRevision = 0,
  visible,
  onSelect,
  onClose,
  onOpen,
  onFileState
}: {
  files: FileDocument[]
  activeFileId?: number
  openRevision?: number
  visible: boolean
  onSelect: (id: number) => void
  onClose: (id: number) => void
  onOpen: (path: string, source: FileDocument) => void
  onFileState: (id: number, state: { path: string; dirty: boolean }) => void
}): React.JSX.Element | null {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const statuses = useAppStore((state) => state.statuses)
  const directorySidebar = useLayoutPreferences((state) => state.fileDirectorySidebar ?? false)
  const preferredWidth = useLayoutPreferences((state) => state.fileTreeWidth ?? 220)
  const content = useRef<HTMLDivElement>(null)
  const directoryToggle = useRef<HTMLButtonElement>(null)
  const pointer = useRef<number | undefined>(undefined)
  const [width, setWidth] = useState(0)
  const hasFiles = files.length > 0
  useEffect(() => {
    const element = content.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasFiles])
  const [view, setView] = useState<{ id: number; browser: boolean; revision: number }>()
  const [locations, setLocations] = useState<Record<string, DirectoryLocation>>({})
  const revision = useRef(0)
  const active = files.find((file) => file.id === activeFileId)
  const contexts = [...new Map(files.map((file) => [targetKey(file.target), file])).values()]
  const canSplit = width >= 440
  const browser =
    !!active &&
    (!active.file ||
      (!canSplit && view?.id === active.id && view.revision === openRevision && view.browser))
  const split = directorySidebar && canSplit && !!active?.file && !browser
  const browserVisible = browser || split
  const maximumWidth = Math.max(180, Math.min(600, width - 245))
  const directoryWidth = Math.min(maximumWidth, Math.max(180, preferredWidth))
  const resizeDirectory = (next: number): void => {
    useLayoutPreferences
      .getState()
      .update({ fileTreeWidth: Math.round(Math.max(180, Math.min(maximumWidth, next))) })
  }
  const collapseDirectory = (): void => {
    useLayoutPreferences.getState().update({ fileDirectorySidebar: false })
    if (active) setView({ id: active.id, browser: false, revision: openRevision })
    directoryToggle.current?.focus()
  }
  const select = (id: number): void => {
    setView({ id, browser: false, revision: openRevision })
    onSelect(id)
  }
  const reveal = (id: number): void => {
    const file = files.find((item) => item.id === id)
    if (!file) return
    onSelect(id)
    useLayoutPreferences.getState().update({ fileDirectorySidebar: true })
    setView({ id, browser: !canSplit, revision: openRevision })
    setLocations((current) => ({
      ...current,
      [targetKey(file.target)]: {
        path: file.file ? remoteParent(file.file) : file.path,
        revision: ++revision.current
      }
    }))
  }
  if (!active) return null
  return (
    <aside
      id="remote-files-panel"
      className="remote-files-panel"
      hidden={!visible}
      aria-label={zh ? '远程文件' : 'Remote files'}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          event.stopPropagation()
          active.actions.current?.save()
        }
      }}
      aria-description={`${active.server} / ${active.target.sessionName}`}
    >
      <header className="file-workspace-header panel-dock-header dock-header">
        {files.some((file) => file.file) ? (
          <PanelTabs
            active="files"
            files={files.map((file) => ({ ...file, path: file.file }))}
            activeFileId={activeFileId}
            onSelectFile={select}
            onCloseFile={(id) => files.find((file) => file.id === id)?.actions.current?.close()}
            onRevealFile={reveal}
            onReloadFile={(id) => files.find((file) => file.id === id)?.actions.current?.reload()}
          />
        ) : (
          <span className="file-workspace-empty-title">{zh ? '文件' : 'Files'}</span>
        )}
        {active.file && (
          <RemoteFileMenu
            className="file-workspace-actions"
            target={active.target}
            path={active.file}
            showTrigger
            onReveal={() => reveal(active.id)}
            onReload={() => active.actions.current?.reload()}
            onClose={() => active.actions.current?.close()}
          >
            <span className="sr-only">{zh ? '当前文件' : 'Current file'}</span>
          </RemoteFileMenu>
        )}
        <button
          ref={directoryToggle}
          className="icon-button file-directory-toggle"
          aria-label={zh ? '目录侧栏' : 'Directory sidebar'}
          title={zh ? '目录侧栏' : 'Directory sidebar'}
          aria-pressed={browserVisible}
          aria-controls="file-workspace-browser"
          disabled={!active.file}
          onClick={() => {
            if (browserVisible) collapseDirectory()
            else {
              useLayoutPreferences.getState().update({ fileDirectorySidebar: true })
              setView({ id: active.id, browser: !canSplit, revision: openRevision })
            }
          }}
        >
          <PanelRight size={16} />
        </button>
      </header>
      <div
        ref={content}
        className="file-workspace-content"
        data-directory-sidebar={split}
        style={{ '--file-directory-width': `${directoryWidth}px` } as CSSProperties}
      >
        <div
          id="file-workspace-browser"
          className="file-workspace-browser"
          hidden={!browserVisible}
        >
          {directorySidebar && !canSplit && browser && active.file && (
            <div className="file-directory-hint">
              {zh
                ? '加宽面板可并排浏览，打开文件后返回内容。'
                : 'Widen this panel for side-by-side browsing. Opening a file returns to its contents.'}
            </div>
          )}
          {contexts.map((context) => (
            <RemoteDirectoryBrowser
              key={targetKey(context.target)}
              target={context.target}
              initialPath={context.path}
              location={locations[targetKey(context.target)]}
              visible={
                visible && browserVisible && targetKey(context.target) === targetKey(active.target)
              }
              selectedPath={active.file}
              onReturn={!split && active.file ? () => select(active.id) : undefined}
              onDismiss={split ? collapseDirectory : undefined}
              onOpen={(path) => {
                setView({ id: active.id, browser: false, revision: openRevision })
                onOpen(path, context)
              }}
            />
          ))}
        </div>
        <div
          className="file-directory-sizer"
          hidden={!split}
          role="separator"
          tabIndex={0}
          aria-label={zh ? '调整目录侧栏宽度' : 'Resize directory sidebar'}
          aria-orientation="vertical"
          aria-controls="file-workspace-browser"
          aria-valuemin={180}
          aria-valuemax={Math.round(maximumWidth)}
          aria-valuenow={Math.round(directoryWidth)}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            pointer.current = event.pointerId
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.focus()
            event.preventDefault()
          }}
          onPointerMove={(event) => {
            if (pointer.current === event.pointerId && content.current)
              resizeDirectory(content.current.getBoundingClientRect().right - event.clientX)
          }}
          onPointerUp={(event) => {
            if (pointer.current !== event.pointerId) return
            pointer.current = undefined
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onLostPointerCapture={() => {
            pointer.current = undefined
          }}
          onDoubleClick={() => resizeDirectory(220)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            resizeDirectory(
              event.key === 'Home'
                ? 220
                : event.key === 'End'
                  ? maximumWidth
                  : directoryWidth + (event.key === 'ArrowLeft' ? 16 : -16)
            )
          }}
        />
        {files
          .filter((file) => file.file)
          .map((file) => (
            <RemoteFilesPanel
              key={file.id}
              id={file.id}
              hidden={browser || file.id !== activeFileId}
              target={file.target}
              initialFile={file.file!}
              actionsRef={file.actions}
              readOnly={
                statuses[targetKey(file.target)]?.state !== 'attached' ||
                !!statuses[targetKey(file.target)]?.readOnly
              }
              onClose={() => onClose(file.id)}
              onOpenReference={(path) => onOpen(path, file)}
              onFileState={(state) => onFileState(file.id, state)}
            />
          ))}
      </div>
    </aside>
  )
}
