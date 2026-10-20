import { RemoteDirectoryBrowser } from '../../src/renderer/src/components/RemoteDirectoryBrowser'
import { createRef, StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { targetKey, useAppStore } from '../../src/renderer/src/store'
import FileWorkspace, { type FileDocument } from '../../src/renderer/src/components/FileWorkspace'
import type { FilePanelActions } from '../../src/renderer/src/components/RemoteFilesPanel'
import { useLayoutPreferences } from '../../src/renderer/src/layout-preferences'

const profile = DEFAULT_SETTINGS.profiles[0]!
const target = { profileId: profile.id, sessionName: 'claude-review' }
const path = '/workspace/notes.md'
let contentWidth = 600
let resizeContent: ((width: number) => void) | undefined
const files = {
  list: vi.fn().mockResolvedValue({
    path: '/workspace',
    parent: '/',
    truncated: false,
    entries: [{ name: 'notes.md', path, kind: 'file', size: 20, modified: Date.now() }]
  }),
  read: vi.fn().mockResolvedValue({
    path,
    content: '# Preview',
    version: 'a'.repeat(64),
    writable: true,
    lineEnding: 'LF'
  }),
  save: vi.fn(),
  download: vi.fn().mockResolvedValue({ canceled: false, path: 'C:/Downloads/notes.md' })
}
beforeEach(() => {
  vi.clearAllMocks()
  contentWidth = 600
  resizeContent = undefined
  useLayoutPreferences.setState({ fileDirectorySidebar: false, fileTreeWidth: undefined })
  useAppStore.setState({
    settings: structuredClone(DEFAULT_SETTINGS),
    timelines: {},
    toast: undefined
  })
  vi.stubGlobal('claudeBridge', { files })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        if (!element.classList.contains('file-workspace-content')) return
        resizeContent = (width) =>
          this.callback(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          )
        resizeContent(contentWidth)
      }
      disconnect() {}
    }
  )
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) }
  })
})

it('keeps an optional directory sidebar beside the editor while opening and switching files', async () => {
  attached()
  files.read.mockImplementation(async (request) => ({
    path: request.path,
    content: '# Preview',
    version: 'a'.repeat(64),
    writable: true,
    lineEnding: 'LF'
  }))
  const { container } = render(<Workspace initial={[path, '/workspace/other.md']} />)
  await screen.findByRole('heading', { name: 'Preview' })
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByRole('textbox', { name: '文件内容' }), {
    target: { value: 'sidebar draft' }
  })
  const toggle = screen.getByRole('button', { name: '目录侧栏' })
  fireEvent.click(toggle)
  await screen.findByRole('button', { name: 'notes.md' })
  expect(container.querySelector('.file-workspace-content')).toHaveAttribute(
    'data-directory-sidebar',
    'true'
  )
  expect(screen.getByRole('textbox', { name: '文件内容' })).toHaveValue('sidebar draft')
  fireEvent.click(screen.getByRole('tab', { name: 'other.md' }))
  expect(screen.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
  expect(screen.getByRole('textbox', { name: '文件内容' })).toHaveValue('sidebar draft')
  expect(screen.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '目录侧栏' }))
  expect(screen.queryByRole('region', { name: '文件夹浏览' })).toBeNull()
  fireEvent.click(toggle)
  expect(screen.getByRole('textbox', { name: '文件内容' })).toHaveValue('sidebar draft')
  expect(container.querySelector('.file-workspace-content')).toHaveAttribute(
    'data-directory-sidebar',
    'true'
  )
  expect(JSON.parse(localStorage.getItem('clb:layout:v1')!).fileDirectorySidebar).toBe(true)
  fireEvent.keyDown(screen.getByRole('textbox', { name: '筛选文件名' }), { key: 'Escape' })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toHaveFocus()
  expect(screen.queryByRole('region', { name: '文件夹浏览' })).toBeNull()
  expect(screen.getByRole('textbox', { name: '文件内容' })).toHaveValue('sidebar draft')
})

it('remembers the preferred inner width while shrinking, reopening, and widening the panel', async () => {
  render(<Workspace />)
  await screen.findByRole('heading', { name: 'Preview' })
  fireEvent.click(screen.getByRole('button', { name: '目录侧栏' }))
  await screen.findByRole('button', { name: 'notes.md' })
  const separator = screen.getByRole('separator', { name: '调整目录侧栏宽度' })
  fireEvent.keyDown(separator, { key: 'ArrowLeft' })
  expect(useLayoutPreferences.getState().fileTreeWidth).toBe(236)
  act(() => resizeContent?.(264))
  expect(screen.queryByRole('region', { name: '文件夹浏览' })).toBeNull()
  expect(screen.getByRole('heading', { name: 'Preview' })).toBeVisible()
  expect(useLayoutPreferences.getState().fileTreeWidth).toBe(236)
  fireEvent.click(screen.getByRole('button', { name: '目录侧栏' }))
  expect(screen.getByText('加宽面板可并排浏览，打开文件后返回内容。')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
  expect(screen.queryByRole('region', { name: '文件夹浏览' })).toBeNull()
  act(() => resizeContent?.(600))
  expect(screen.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
  expect(separator).toHaveAttribute('aria-valuenow', '236')
  fireEvent.click(screen.getByRole('button', { name: '关闭 notes.md' }))
  expect(screen.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
  expect(screen.queryByRole('separator', { name: '调整目录侧栏宽度' })).toBeNull()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Workspace({ initial = [path] }: { initial?: string[] }): React.JSX.Element {
  const [documents, setDocuments] = useState<FileDocument[]>(
    initial.map((file, id) => ({
      id,
      file,
      path: '/workspace',
      target,
      server: 'Test',
      dirty: false,
      actions: createRef<FilePanelActions>()
    }))
  )
  const [active, setActive] = useState(0)
  return (
    <FileWorkspace
      files={documents}
      activeFileId={active}
      visible
      onSelect={setActive}
      onClose={(id) => {
        const rest = documents.filter((item) => item.id !== id)
        setDocuments(rest.length ? rest : [{ ...documents[0]!, file: undefined, dirty: false }])
        if (active === id && rest.length) setActive(rest[0]!.id)
      }}
      onOpen={(next, source) => {
        const existing = documents.find((item) => item.file === next)
        if (existing) {
          setActive(existing.id)
          return
        }
        const id = Math.max(...documents.map((item) => item.id)) + 1
        setDocuments([
          ...documents,
          { ...source, id, file: next, dirty: false, actions: createRef<FilePanelActions>() }
        ])
        setActive(id)
      }}
      onFileState={(id, state) =>
        setDocuments((current) => {
          if (current.find((item) => item.id === id)?.dirty === state.dirty) return current
          return current.map((item) =>
            item.id === id ? { ...item, file: state.path, dirty: state.dirty } : item
          )
        })
      }
    />
  )
}

function attached(): void {
  useAppStore.setState({
    statuses: {
      [targetKey(target)]: {
        ...target,
        state: 'attached',
        readOnly: false,
        generating: false,
        promptState: 'ready',
        attempt: 0,
        changedAt: Date.now()
      }
    }
  })
}

it('uses one tab header, a trailing directory toggle and discoverable context actions', async () => {
  const { container } = render(
    <StrictMode>
      <Workspace />
    </StrictMode>
  )
  await screen.findByRole('heading', { name: 'Preview' })
  expect(files.list).not.toHaveBeenCalled()
  expect(container.querySelectorAll('.panel-dock-header')).toHaveLength(1)
  const browse = screen.getByRole('button', { name: '目录侧栏' })
  expect(screen.queryByRole('button', { name: '浏览文件夹' })).toBeNull()
  expect(browse.parentElement?.lastElementChild).toBe(browse)
  fireEvent.click(browse)
  const row = await screen.findByRole('button', { name: 'notes.md' })
  expect(screen.getByRole('heading', { name: 'Preview' })).toBeVisible()
  fireEvent.contextMenu(row)
  fireEvent.click(screen.getByRole('menuitem', { name: '下载文件…' }))
  await waitFor(() => expect(files.download).toHaveBeenCalledWith({ ...target, path }))
  fireEvent.contextMenu(row)
  fireEvent.click(screen.getByRole('menuitem', { name: '复制路径' }))
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(path)
  fireEvent.click(row)
  expect(browse).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(browse)
  expect(browse).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('heading', { name: 'Preview' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '文件操作' }))
  expect(screen.getByRole('menuitem', { name: '重新读取' })).toBeVisible()
  fireEvent.click(screen.getByRole('menuitem', { name: '在文件夹中显示' }))
  await waitFor(() => expect(browse).toHaveAttribute('aria-pressed', 'true'))
  fireEvent.click(browse)
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'notes.md' }))
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '关闭标签页' }))
  await screen.findByRole('region', { name: '文件夹浏览' })
  expect(screen.queryByRole('tab')).toBeNull()
})

it('preserves drafts and browser location when switching files; background close does not select it', async () => {
  attached()
  files.read.mockImplementation(async (request) => ({
    path: request.path,
    content: '# Preview',
    version: 'a'.repeat(64),
    writable: true,
    lineEnding: 'LF'
  }))
  render(<Workspace initial={[path, '/workspace/other.md']} />)
  await screen.findByRole('heading', { name: 'Preview' })
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByRole('textbox', { name: '文件内容' }), {
    target: { value: 'unsaved draft' }
  })
  fireEvent.click(screen.getByRole('button', { name: '目录侧栏' }))
  const input = await screen.findByRole('textbox', { name: '文件夹路径' })
  files.list.mockResolvedValueOnce({
    path: '/workspace/docs',
    parent: '/workspace',
    truncated: false,
    entries: []
  })
  fireEvent.change(input, { target: { value: '/workspace/docs' } })
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(input).toHaveValue('/workspace/docs'))
  fireEvent.click(screen.getByRole('tab', { name: 'other.md' }))
  expect(screen.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace/docs')
  fireEvent.click(screen.getByRole('tab', { name: 'notes.md' }))
  expect(screen.getByRole('textbox', { name: '文件内容' })).toHaveValue('unsaved draft')
  fireEvent.click(screen.getByRole('tab', { name: 'other.md' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭 notes.md' }))
  expect(screen.getByRole('dialog', { name: '尚有未保存内容' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByRole('tab', { name: 'other.md' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(screen.getByRole('button', { name: '关闭 notes.md' }))
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
  expect(screen.queryByRole('tab', { name: 'notes.md' })).toBeNull()
  expect(screen.getByRole('tab', { name: 'other.md' })).toHaveAttribute('aria-selected', 'true')
})

it('offers download and retry when file preview fails without loading its directory', async () => {
  files.read.mockRejectedValueOnce(new Error('NOT_TEXT'))
  render(<Workspace />)
  await screen.findByRole('alert')
  expect(files.list).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '文件操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '下载文件…' }))
  await waitFor(() => expect(files.download).toHaveBeenCalledWith({ ...target, path }))
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByRole('heading', { name: 'Preview' })
})

it('ignores superseded directory responses and reports an empty filter', async () => {
  let finish: (value: unknown) => void = () => undefined
  files.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  render(<RemoteDirectoryBrowser target={target} initialPath="/old" visible onOpen={vi.fn()} />)
  const input = screen.getByRole('textbox', { name: '文件夹路径' })
  fireEvent.change(input, { target: { value: '/workspace' } })
  fireEvent.click(screen.getByRole('button', { name: '前往' }))
  await screen.findByRole('button', { name: 'notes.md' })
  finish({ path: '/stale', parent: '/', entries: [], truncated: false })
  await waitFor(() => expect(input).toHaveValue('/workspace'))
  fireEvent.change(screen.getByRole('textbox', { name: '筛选文件名' }), {
    target: { value: 'missing' }
  })
  expect(screen.queryByRole('button', { name: 'notes.md' })).toBeNull()
  expect(screen.getByText('没有匹配的文件')).toBeVisible()
})

it('loads an initially open browser in StrictMode', async () => {
  render(
    <StrictMode>
      <RemoteDirectoryBrowser target={target} initialPath="/workspace" visible onOpen={vi.fn()} />
    </StrictMode>
  )
  await screen.findByRole('button', { name: 'notes.md' })
  expect(screen.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace')
})

it('keeps a conflicting save editable and requires confirmation before reloading it', async () => {
  attached()
  files.save.mockRejectedValueOnce(new Error('CONFLICT'))
  render(<Workspace />)
  await screen.findByRole('heading', { name: 'Preview' })
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  const editor = screen.getByRole('textbox', { name: '文件内容' })
  fireEvent.change(editor, { target: { value: 'my draft' } })
  fireEvent.keyDown(screen.getByRole('tab', { name: 'notes.md' }), { key: 's', ctrlKey: true })
  expect(await screen.findByRole('alert')).toHaveTextContent('远端文件已变化')
  expect(editor).toHaveValue('my draft')
  expect(editor).not.toHaveAttribute('readonly')
  fireEvent.click(screen.getByRole('button', { name: '文件操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '重新读取' }))
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(editor).toHaveValue('my draft')
  expect(files.read).toHaveBeenCalledTimes(1)
})

it('deduplicates a pending download across menus and unlocks after cancellation', async () => {
  let finish: (result: { canceled: boolean }) => void = () => undefined
  files.download.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  render(<Workspace />)
  await screen.findByRole('heading', { name: 'Preview' })
  fireEvent.click(screen.getByRole('button', { name: '文件操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '下载文件…' }))
  fireEvent.contextMenu(screen.getByRole('tab', { name: 'notes.md' }))
  expect(screen.getByRole('menuitem', { name: '正在下载…' })).toBeDisabled()
  expect(files.download).toHaveBeenCalledTimes(1)
  finish({ canceled: true })
  await waitFor(() =>
    expect(screen.getByRole('menuitem', { name: '下载文件…' })).not.toBeDisabled()
  )
  expect(useAppStore.getState().toast).toBeUndefined()
})
