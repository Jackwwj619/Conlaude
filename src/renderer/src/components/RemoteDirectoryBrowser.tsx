import {
  ArrowLeft, ChevronDown, ChevronRight, ChevronsDownUp, Eye, FileCode2,
  FileImage, FileText, Folder, FolderOpen, RefreshCw, Search
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionTarget } from '../../../shared/contracts'
import type { RemoteDirectory, RemoteFileEntry } from '../../../shared/remote-files'
import { useI18n } from '../i18n'
import { fileError } from '../file-errors'
import { RemoteFileMenu } from './RemoteFileMenu'
import '../remote-directory-tree.css'

export interface DirectoryLocation {
  path: string
  revision: number
}

interface Props {
  target: SessionTarget
  initialPath: string
  location?: DirectoryLocation
  visible: boolean
  selectedPath?: string
  onOpen: (path: string) => void
  onReturn?: () => void
  onDismiss?: () => void
}

interface Level {
  directory?: RemoteDirectory
  loading: boolean
  error?: unknown
}

interface Tree {
  root: string
  levels: Record<string, Level>
  expanded: Set<string>
}

type Row =
  | {
      kind: 'entry'
      entry: RemoteFileEntry
      parent: string
      depth: number
      expanded: boolean
      position: number
      siblings: number
    }
  | { kind: 'loading' | 'empty' | 'error' | 'truncated'; path: string; depth: number }

function withinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root.replace(/\/+$/, '')}/`)
}

/** Filter the expanded tree locally; never recursively scan the server. */
function rowsFor(tree: Tree, query: string, hidden: boolean, language: string): Row[] {
  const order = new Intl.Collator(language, { numeric: true, sensitivity: 'base' })
  const needle = query.trim().toLocaleLowerCase(language)
  const matched = new Map<string, boolean>()
  const matches = (entry: RemoteFileEntry, ancestors: Set<string>): boolean => {
    if (!hidden && entry.name.startsWith('.')) return false
    if (!needle || entry.name.toLocaleLowerCase(language).includes(needle)) return true
    if (entry.kind !== 'directory' || !tree.expanded.has(entry.path) || ancestors.has(entry.path)) return false
    if (matched.has(entry.path)) return matched.get(entry.path)!
    const seen = new Set(ancestors).add(entry.path)
    const result = (tree.levels[entry.path]?.directory?.entries ?? [])
      .some((child) => matches(child, seen))
    matched.set(entry.path, result)
    return result
  }
  const rows: Row[] = []
  const visit = (path: string, depth: number, ancestors: Set<string>): void => {
    if (ancestors.has(path)) return
    const seen = new Set(ancestors).add(path)
    const level = tree.levels[path]
    if (!level?.directory) {
      rows.push({ kind: level?.error ? 'error' : 'loading', path, depth })
      return
    }
    if (level.error) rows.push({ kind: 'error', path, depth })
    if (level.loading) rows.push({ kind: 'loading', path, depth })
    const entries = level.directory.entries.filter((entry) => matches(entry, seen))
      .sort((a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        order.compare(a.name, b.name)
      )
    if (!entries.length && !level.loading && !level.error)
      rows.push({ kind: 'empty', path, depth })
    entries.forEach((entry, index) => {
      const expanded = entry.kind === 'directory' && tree.expanded.has(entry.path)
      rows.push({
        kind: 'entry', entry, parent: path, depth, expanded,
        position: index + 1, siblings: entries.length
      })
      if (expanded) visit(entry.path, depth + 1, seen)
    })
    if (level.directory.truncated) rows.push({ kind: 'truncated', path, depth })
  }
  visit(tree.root, 0, new Set())
  return rows
}

/** A different target owns a different tree, including its pending requests. */
export function RemoteDirectoryBrowser(props: Props): React.JSX.Element {
  return <DirectoryTree key={JSON.stringify([props.target.profileId, props.target.sessionName])} {...props} />
}

function DirectoryTree({
  target, initialPath, location, visible, selectedPath, onOpen, onReturn, onDismiss
}: Props): React.JSX.Element {
  const { language } = useI18n()
  const zh = language === 'zh-CN'
  const label = (cn: string, en: string): string => (zh ? cn : en)
  const [tree, setTree] = useState<Tree>(() => ({
    root: initialPath, levels: {}, expanded: new Set()
  }))
  const current = useRef(tree)
  const [path, setPath] = useState(initialPath)
  const [query, setQuery] = useState('')
  const [showHidden, setShowHidden] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [focused, setFocused] = useState<string>()
  const mounted = useRef(false)
  const active = useRef(visible)
  active.current = visible
  const generation = useRef(0)
  const revealRequest = useRef(0)
  const initialized = useRef(false)
  const appliedLocation = useRef<DirectoryLocation | undefined>(undefined)
  const pendingReveal = useRef<string | undefined>(undefined)
  const startPath = useRef(initialPath)
  const inflight = useRef(new Map<string, Promise<RemoteDirectory | undefined>>())
  const list = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const rows = useMemo(
    () => rowsFor(tree, query, showHidden, language),
    [tree, query, showHidden, language]
  )
  const entryRows = rows.filter((row): row is Extract<Row, { kind: 'entry' }> => row.kind === 'entry')
  const focusable = entryRows.filter((row) => row.entry.kind === 'directory' || row.entry.kind === 'file')
  const tabStop = focusable.some((row) => row.entry.path === focused) ? focused : focusable[0]?.entry.path

  const commit = (change: (previous: Tree) => Tree): void => {
    if (!mounted.current) return
    current.current = change(current.current)
    setTree(current.current)
  }
  const stillCurrent = (epoch: number): boolean => mounted.current && generation.current === epoch

  const load = (directoryPath: string): Promise<RemoteDirectory | undefined> => {
    const pending = inflight.current.get(directoryPath)
    if (pending) return pending
    const epoch = generation.current
    commit((previous) => ({
      ...previous,
      levels: {
        ...previous.levels,
        [directoryPath]: { ...previous.levels[directoryPath], loading: true, error: undefined }
      }
    }))
    const operation = window.claudeBridge.files.list({ ...target, path: directoryPath })
      .then((result) => {
        if (!stillCurrent(epoch) || inflight.current.get(directoryPath) !== operation) return undefined
        commit((previous) => {
          const levels = { ...previous.levels }
          const expanded = new Set(previous.expanded)
          // Only a complete listing proves that an old subtree disappeared.
          if (!result.truncated) {
            const directories = new Set(result.entries.filter((entry) => entry.kind === 'directory')
              .map((entry) => entry.path))
            for (const old of previous.levels[directoryPath]?.directory?.entries ?? []) {
              if (old.kind !== 'directory' || directories.has(old.path)) continue
              for (const key of Object.keys(levels)) if (withinRoot(key, old.path)) delete levels[key]
              for (const key of expanded) if (withinRoot(key, old.path)) expanded.delete(key)
              for (const key of inflight.current.keys())
                if (withinRoot(key, old.path)) inflight.current.delete(key)
            }
          }
          const isRoot = previous.root === directoryPath
          const key = isRoot ? result.path : directoryPath
          if (isRoot && key !== directoryPath) delete levels[directoryPath]
          levels[key] = { directory: result, loading: false }
          return { root: isRoot ? result.path : previous.root, levels, expanded }
        })
        if (current.current.root === result.path) setPath(result.path)
        return result
      })
      .catch((error: unknown) => {
        if (stillCurrent(epoch) && inflight.current.get(directoryPath) === operation) commit((previous) => ({
          ...previous,
          levels: {
            ...previous.levels,
            [directoryPath]: { ...previous.levels[directoryPath], loading: false, error }
          }
        }))
        return undefined
      })
      .finally(() => {
        if (inflight.current.get(directoryPath) === operation) inflight.current.delete(directoryPath)
      })
    inflight.current.set(directoryPath, operation)
    return operation
  }

  const browse = async (next: string): Promise<void> => {
    if (!next.trim()) return
    generation.current++
    revealRequest.current++
    inflight.current.clear()
    initialized.current = true
    setRefreshing(false)
    setQuery('')
    setFocused(undefined)
    setPath(next.trim())
    commit(() => ({ root: next.trim(), levels: {}, expanded: new Set() }))
    list.current?.scrollTo?.({ top: 0 })
    await load(next.trim())
  }

  const branchVisible = (directoryPath: string): boolean => {
    if (!active.current) return false
    const state = current.current
    if (!withinRoot(directoryPath, state.root)) return false
    let path = directoryPath
    while (path !== state.root) {
      if (!state.expanded.has(path)) return false
      const parent = path.slice(0, path.lastIndexOf('/')) || '/'
      if (parent === path) return false
      path = parent
    }
    return true
  }

  // Refresh only visible branches, serially, without blanking their cached rows.
  const refreshBranch = async (directoryPath: string, epoch = generation.current): Promise<void> => {
    if (!stillCurrent(epoch) || !branchVisible(directoryPath)) return
    const result = await load(directoryPath)
    if (!result || !stillCurrent(epoch) || !branchVisible(current.current.root === result.path ? result.path : directoryPath)) return
    for (const entry of result.entries) {
      if (!stillCurrent(epoch)) return
      if (entry.kind === 'directory' && branchVisible(entry.path)) await refreshBranch(entry.path, epoch)
    }
  }
  const refresh = async (): Promise<void> => {
    if (refreshing) return
    const epoch = generation.current
    setRefreshing(true)
    try {
      await refreshBranch(current.current.root, epoch)
    } finally {
      if (stillCurrent(epoch)) setRefreshing(false)
    }
  }
  const toggle = (directoryPath: string): void => {
    revealRequest.current++
    const opening = !current.current.expanded.has(directoryPath)
    commit((previous) => {
      const expanded = new Set(previous.expanded)
      if (opening) expanded.add(directoryPath)
      else expanded.delete(directoryPath)
      return { ...previous, expanded }
    })
    // Descendant expansion preferences survive collapse; reopening revalidates them.
    if (opening) void refreshBranch(directoryPath)
  }
  const reveal = async (directoryPath: string): Promise<void> => {
    if (!initialized.current) {
      const pending = browse(startPath.current)
      const epoch = generation.current
      const request = revealRequest.current
      await pending
      if (!stillCurrent(epoch) || request !== revealRequest.current || !active.current) return
    }
    if (!withinRoot(directoryPath, current.current.root)) {
      await browse(directoryPath)
      return
    }
    const epoch = generation.current
    const request = ++revealRequest.current
    const currentReveal = (): boolean => stillCurrent(epoch) && request === revealRequest.current && active.current
    setQuery('')
    setShowHidden(true)
    const root = current.current.root
    const suffix = directoryPath.slice(root === '/' ? 1 : root.length + 1)
    if (directoryPath === root) return
    let parent = root
    for (const part of suffix.split('/').filter(Boolean)) {
      if (!currentReveal()) return
      const cached = current.current.levels[parent]?.directory
      let level = cached ?? await load(parent)
      if (!level || !currentReveal()) return
      let child = level.entries.find((entry) => entry.name === part && entry.kind === 'directory')
      // A newly created folder may not be in a previously cached parent listing.
      if (!child && cached) {
        level = await load(parent)
        if (!level || !currentReveal()) return
        child = level.entries.find((entry) => entry.name === part && entry.kind === 'directory')
      }
      if (!child) return
      commit((previous) => ({ ...previous, expanded: new Set(previous.expanded).add(child.path) }))
      await load(child.path)
      parent = child.path
    }
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current++
      inflight.current.clear()
      initialized.current = false
      appliedLocation.current = undefined
    }
  }, [])
  useEffect(() => {
    if (!visible) return
    if (location && (appliedLocation.current?.path !== location.path ||
      appliedLocation.current?.revision !== location.revision)) {
      appliedLocation.current = location
      pendingReveal.current = selectedPath
      void reveal(location.path)
    } else if (!initialized.current) void browse(startPath.current)
    // The tree is owned by this target; hiding it preserves levels and scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, location])
  useEffect(() => {
    if (!visible || !selectedPath || pendingReveal.current !== selectedPath) return
    const button = buttons.current.get(selectedPath)
    if (!button) return
    pendingReveal.current = undefined
    setFocused(selectedPath)
    button.scrollIntoView?.({ block: 'nearest' })
  }, [rows, selectedPath, visible])

  const focus = (next?: string): void => {
    if (!next) return
    const button = buttons.current.get(next)
    if (!button) return
    setFocused(next)
    button.focus()
  }
  const rootLevel = tree.levels[tree.root]
  return (
    <section hidden={!visible} className="remote-directory-browser remote-directory-tree"
      aria-label={label('文件夹浏览', 'Directory browser')}
      onKeyDown={(event) => {
        const dismiss = onDismiss ?? onReturn
        if (event.key === 'Escape' && dismiss) {
          event.preventDefault()
          event.stopPropagation()
          dismiss()
        }
      }}>
      <header className="remote-tree-header">
        {onReturn && <button type="button" className="icon-button" onClick={onReturn}
          aria-label={label('返回文件', 'Back to file')} title={label('返回文件', 'Back to file')}>
          <ArrowLeft size={16} />
        </button>}
        <Folder size={16} className="remote-tree-root-icon" aria-hidden="true" />
        <form className="remote-tree-path" onSubmit={(event) => {
          event.preventDefault()
          void browse(path)
        }}>
          <input value={path} onChange={(event) => setPath(event.target.value)}
            aria-label={label('文件夹路径', 'Directory path')} title={tree.root} spellCheck={false}
            onFocus={(event) => event.currentTarget.select()} />
          <button type="submit" aria-label={label('前往', 'Go')} title={label('前往目录', 'Go to directory')}>
            <ChevronRight size={15} />
          </button>
        </form>
        <button type="button" className="icon-button" onClick={() => void refresh()}
          disabled={refreshing || !!rootLevel?.loading}
          title={label('刷新目录', 'Refresh directory')} aria-label={label('刷新目录', 'Refresh directory')}>
          <RefreshCw size={15} className={refreshing || rootLevel?.loading ? 'remote-file-spinning' : undefined} />
        </button>
      </header>
      <div className="remote-tree-filter">
        <Search size={14} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          aria-label={label('筛选文件名', 'Filter files')}
          placeholder={label('筛选已展开文件…', 'Filter expanded files…')} />
        <button type="button" className="icon-button" aria-pressed={showHidden}
          title={label('显示隐藏文件', 'Show hidden files')} aria-label={label('显示隐藏文件', 'Show hidden files')}
          onClick={() => setShowHidden(!showHidden)}><Eye size={15} /></button>
        <button type="button" className="icon-button"
          title={label('全部折叠', 'Collapse all')} aria-label={label('全部折叠', 'Collapse all')}
          disabled={!tree.expanded.size} onClick={() => {
            revealRequest.current++
            setQuery('')
            commit((previous) => ({ ...previous, expanded: new Set() }))
          }}><ChevronsDownUp size={15} /></button>
      </div>
      <div ref={list} className="file-browser-list remote-tree-body" role="tree"
        aria-label={label('工作目录文件树', 'Workspace file tree')} aria-busy={!!rootLevel?.loading}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.remote-file-row')
          const index = focusable.findIndex((row) => buttons.current.get(row.entry.path) === button)
          if (index < 0) return
          const row = focusable[index]!
          if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'ArrowRight') {
            if (row.entry.kind !== 'directory') return
            if (!row.expanded) toggle(row.entry.path)
            else if (focusable[index + 1]?.parent === row.entry.path) focus(focusable[index + 1]!.entry.path)
          } else if (event.key === 'ArrowLeft') {
            if (row.entry.kind === 'directory' && row.expanded) toggle(row.entry.path)
            else focus(row.parent)
          } else {
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? focusable.length - 1
              : Math.max(0, Math.min(focusable.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
            focus(focusable[next]?.entry.path)
          }
        }}>
        {rows.map((row) => {
          if (row.kind !== 'entry') return (
            <div key={`${row.kind}:${row.path}`} className={`remote-tree-note remote-tree-note-${row.kind}`}
              style={{ paddingInlineStart: 10 + row.depth * 18 }}
              role={row.kind === 'error' ? 'alert' : 'status'}>
              {row.kind === 'loading' ? label('正在读取目录…', 'Loading folder…')
                : row.kind === 'empty' ? (query.trim() ? label('没有匹配的文件', 'No matching files') : label('此文件夹为空', 'This folder is empty'))
                  : row.kind === 'truncated' ? label('仅显示前 2000 项', 'Limited to 2,000 entries')
                    : fileError(tree.levels[row.path]?.error, zh)}
              {row.kind === 'error' && <button type="button" onClick={() => void refreshBranch(row.path)}
                aria-label={label('重试读取目录', 'Retry directory')}>
                {label('重试', 'Retry')}
              </button>}
            </div>
          )
          const { entry } = row
          const directory = entry.kind === 'directory'
          const disabled = entry.kind !== 'directory' && entry.kind !== 'file'
          const Icon = directory ? (row.expanded ? FolderOpen : Folder)
            : /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(entry.name) ? FileImage
              : /\.(tsx?|jsx?|py|rs|go|java|json|ya?ml|toml|css|html|sh)$/i.test(entry.name) ? FileCode2 : FileText
          const open = (): void => {
            if (disabled) return
            setFocused(entry.path)
            if (directory) toggle(entry.path)
            else onOpen(entry.path)
          }
          return (
            <div key={entry.path} role="treeitem" aria-label={entry.name}
              aria-level={row.depth + 1} aria-posinset={row.position} aria-setsize={row.siblings}
              aria-expanded={directory ? row.expanded : undefined}
              aria-selected={entry.path === selectedPath} aria-disabled={disabled || undefined}
              data-tree-path={entry.path}>
              <RemoteFileMenu target={target} path={entry.path} directory={entry.kind !== 'file'}
                onOpen={disabled ? undefined : () => {
                  if (!directory || !current.current.expanded.has(entry.path)) open()
                }}>
                <button type="button" className="remote-file-row remote-tree-row"
                  ref={(element) => {
                    if (element) buttons.current.set(entry.path, element)
                    else buttons.current.delete(entry.path)
                  }}
                  style={{ paddingInlineStart: 10 + row.depth * 18 }}
                  disabled={disabled} tabIndex={entry.path === tabStop ? 0 : -1}
                  data-selected={entry.path === selectedPath} data-kind={entry.kind}
                  aria-current={entry.path === selectedPath ? 'true' : undefined}
                  aria-expanded={directory ? row.expanded : undefined} aria-label={entry.name}
                  title={disabled ? `${entry.path}\n${label('此条目不支持打开', 'This entry cannot be opened')}` : entry.path}
                  onFocus={() => setFocused(entry.path)} onClick={open}>
                  <Icon size={16} aria-hidden="true" className={directory ? 'directory' : 'remote-tree-file-icon'} />
                  <span className="remote-file-name">{entry.name}</span>
                  {directory && (row.expanded ? <ChevronDown size={12} className="remote-tree-chevron" aria-hidden="true" />
                    : <ChevronRight size={12} className="remote-tree-chevron" aria-hidden="true" />)}
                </button>
              </RemoteFileMenu>
            </div>
          )
        })}
      </div>
      {query.trim() && <footer className="remote-tree-filter-note" role="status">
        {label('仅筛选已展开条目，清空筛选可展开更多文件夹', 'Filtering expanded entries only. Clear the filter to expand more folders.')}
      </footer>}
    </section>
  )
}
