import { ArrowLeft, ArrowUp, Eye, Folder, FileText, Home, RefreshCw, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import type { RemoteDirectory } from '../../../shared/remote-files'
import { useI18n } from '../i18n'
import { fileError } from '../file-errors'
import { RemoteFileMenu } from './RemoteFileMenu'

export interface DirectoryLocation {
  path: string
  revision: number
}

/** One browser per session, independent of its open editor tabs. */
export function RemoteDirectoryBrowser({
  target,
  initialPath,
  location,
  visible,
  selectedPath,
  onOpen,
  onReturn,
  onDismiss
}: {
  target: SessionTarget
  initialPath: string
  location?: DirectoryLocation
  visible: boolean
  selectedPath?: string
  onOpen: (path: string) => void
  onReturn?: () => void
  onDismiss?: () => void
}): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const label = (cn: string, en: string): string => (zh ? cn : en)
  const [directory, setDirectory] = useState<RemoteDirectory>()
  const [path, setPath] = useState(initialPath)
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const startPath = useRef(initialPath)
  const request = useRef(0)
  const initialized = useRef(false)
  const appliedLocation = useRef<DirectoryLocation | undefined>(undefined)
  const list = useRef<HTMLDivElement>(null)
  const browse = async (next: string): Promise<void> => {
    const id = ++request.current
    initialized.current = true
    setBusy(true)
    setError('')
    try {
      const result = await window.claudeBridge.files.list({ ...target, path: next.trim() })
      if (id !== request.current) return
      setDirectory(result)
      setPath(result.path)
      setQuery('')
      list.current?.scrollTo?.({ top: 0 })
    } catch (reason) {
      if (id === request.current) setError(fileError(reason, zh))
    } finally {
      if (id === request.current) setBusy(false)
    }
  }
  useEffect(
    () => () => {
      request.current++
      initialized.current = false
      appliedLocation.current = undefined
    },
    []
  )
  useEffect(() => {
    if (!visible) return
    if (location && appliedLocation.current !== location) {
      appliedLocation.current = location
      void browse(location.path)
    } else if (!initialized.current) void browse(startPath.current)
    // A hidden browser retains its location and listing without making requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, location])
  const entries = (directory?.entries ?? [])
    .filter(
      (entry) =>
        (showHidden || !entry.name.startsWith('.')) &&
        entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    )
    .sort(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name, language, { numeric: true })
    )
  return (
    <section
      hidden={!visible}
      className="remote-directory-browser"
      aria-label={label('文件夹浏览', 'Directory browser')}
      onKeyDown={(event) => {
        const dismiss = onDismiss ?? onReturn
        if (event.key === 'Escape' && dismiss) {
          event.preventDefault()
          event.stopPropagation()
          dismiss()
        }
      }}
    >
      <div className="file-browser-navigation">
        {onReturn && (
          <button
            className="icon-button"
            onClick={onReturn}
            aria-label={label('返回文件', 'Back to file')}
            title={label('返回文件', 'Back to file')}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <button
          className="icon-button"
          disabled={busy || !directory || directory.path === directory.parent}
          onClick={() => directory && void browse(directory.parent)}
          aria-label={label('上级目录', 'Parent directory')}
          title={label('上级目录', 'Parent directory')}
        >
          <ArrowUp size={16} />
        </button>
        <form
          className="file-browser-path"
          onSubmit={(event) => {
            event.preventDefault()
            void browse(path)
          }}
        >
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            aria-label={label('文件夹路径', 'Directory path')}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button type="submit" title={label('前往目录', 'Go to directory')}>
            {label('前往', 'Go')}
          </button>
        </form>
      </div>
      <div className="file-browser-filter">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={label('筛选文件名', 'Filter files')}
          placeholder={label('筛选当前文件夹…', 'Filter this folder…')}
        />
        <button
          className="icon-button"
          aria-pressed={showHidden}
          title={label('显示隐藏文件', 'Show hidden files')}
          aria-label={label('显示隐藏文件', 'Show hidden files')}
          onClick={() => setShowHidden(!showHidden)}
        >
          <Eye size={15} />
        </button>
        <button
          className="icon-button"
          disabled={busy}
          title={label('起始目录', 'Starting folder')}
          aria-label={label('起始目录', 'Starting folder')}
          onClick={() => void browse(startPath.current)}
        >
          <Home size={15} />
        </button>
        <button
          className="icon-button"
          disabled={busy}
          title={label('刷新目录', 'Refresh directory')}
          aria-label={label('刷新目录', 'Refresh directory')}
          onClick={() => void browse(directory?.path ?? path)}
        >
          <RefreshCw size={15} className={busy ? 'remote-file-spinning' : undefined} />
        </button>
      </div>
      {error && (
        <div className="remote-file-error" role="alert">
          {error}
        </div>
      )}
      <div className="file-browser-columns">
        <span>{label('名称', 'Name')}</span>
        <span>{label('大小', 'Size')}</span>
      </div>
      <div
        ref={list}
        className="file-browser-list"
        aria-busy={busy}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '.remote-file-row:not(:disabled)'
            )
          ]
          const index = buttons.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : Math.max(
                    0,
                    Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))
                  )
          buttons[next]?.focus()
        }}
      >
        {entries.map((entry) => (
          <RemoteFileMenu
            key={entry.path}
            target={target}
            path={entry.path}
            directory={entry.kind !== 'file'}
            onOpen={
              busy || entry.kind === 'other'
                ? undefined
                : () => (entry.kind === 'directory' ? void browse(entry.path) : onOpen(entry.path))
            }
          >
            <button
              className="remote-file-row"
              disabled={busy || entry.kind === 'other'}
              data-selected={entry.path === selectedPath}
              aria-current={entry.path === selectedPath ? 'true' : undefined}
              aria-label={entry.name}
              title={`${entry.path}\n${new Date(entry.modified).toLocaleString(language)}${entry.kind === 'directory' ? '' : ` · ${entry.size} B`}`}
              onClick={() =>
                entry.kind === 'directory' ? void browse(entry.path) : onOpen(entry.path)
              }
            >
              {entry.kind === 'directory' ? (
                <Folder size={16} className="directory" />
              ) : (
                <FileText size={16} />
              )}
              <span className="remote-file-name">{entry.name}</span>
              <span className="remote-file-size">
                {entry.kind === 'directory'
                  ? '—'
                  : entry.size < 1024
                    ? `${entry.size} B`
                    : entry.size < 1048576
                      ? `${(entry.size / 1024).toFixed(1)} KB`
                      : `${(entry.size / 1048576).toFixed(1)} MB`}
              </span>
            </button>
          </RemoteFileMenu>
        ))}
        {!entries.length && (
          <div className="remote-file-list-empty">
            {busy
              ? label('正在读取目录…', 'Loading folder…')
              : !directory
                ? label('目录尚未加载', 'Folder not loaded')
                : query
                  ? label('没有匹配的文件', 'No matching files')
                  : label('此文件夹为空', 'This folder is empty')}
          </div>
        )}
      </div>
      <footer className="file-browser-footer">
        <span>
          {busy ? label('正在读取…', 'Loading…') : `${entries.length} ${label('项', 'items')}`}
        </span>
        <span>
          {directory?.truncated
            ? label('仅显示前 2000 项', 'Limited to 2,000 entries')
            : label('右键查看更多操作', 'Right-click for actions')}
        </span>
      </footer>
    </section>
  )
}
