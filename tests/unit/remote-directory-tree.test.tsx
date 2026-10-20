import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RemoteDirectory, RemoteFileEntry } from '../../src/shared/remote-files'
import { RemoteDirectoryBrowser } from '../../src/renderer/src/components/RemoteDirectoryBrowser'

vi.mock('../../src/renderer/src/i18n', () => ({
  useI18n: () => ({ language: 'zh-CN' })
}))
// Existing workspace-fixes tests exercise the real menus and editor/draft integration.
vi.mock('../../src/renderer/src/components/RemoteFileMenu', () => ({
  RemoteFileMenu: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const target = { profileId: 'test-profile', sessionName: 'claude-tree' }
const root = '/workspace'
const item = (path: string, kind: RemoteFileEntry['kind'] = 'file'): RemoteFileEntry => ({
  path, kind, name: path.split('/').at(-1)!, size: 10, modified: 0
})
const directory = (path: string, entries: RemoteFileEntry[] = [], truncated = false): RemoteDirectory => ({
  path, parent: path.slice(0, path.lastIndexOf('/')) || '/', entries, truncated
})
const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
let listings: Map<string, RemoteDirectory>
const files = { list: vi.fn(), read: vi.fn(), save: vi.fn(), download: vi.fn() }
const props = { target, initialPath: root, visible: true, onOpen: vi.fn() }
const row = (name: string): HTMLElement => screen.getByRole('button', { name, exact: true })
const tree = (): HTMLElement => screen.getByRole('tree', { name: '工作目录文件树' })
const pathInput = (): HTMLElement => screen.getByRole('textbox', { name: '文件夹路径' })
const refresh = (): HTMLElement => row('刷新目录')
const requested = (): string[] => files.list.mock.calls.map(([request]) => request.path)

beforeEach(() => {
  vi.resetAllMocks()
  listings = new Map([
    [root, directory(root, [
      item(`${root}/file10.txt`), item(`${root}/src`, 'directory'),
      item(`${root}/.gitignore`), item(`${root}/file2.txt`),
      item(`${root}/docs`, 'directory'), item(`${root}/link`, 'symlink')
    ])],
    [`${root}/src`, directory(`${root}/src`, [
      item(`${root}/src/components`, 'directory'), item(`${root}/src/main.ts`)
    ])],
    [`${root}/src/components`, directory(`${root}/src/components`, [
      item(`${root}/src/components/App.tsx`)
    ])],
    [`${root}/docs`, directory(`${root}/docs`)]
  ])
  files.list.mockImplementation(async ({ path }: { path: string }) =>
    structuredClone(listings.get(path) ?? directory(path))
  )
  vi.stubGlobal('claudeBridge', { files })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('waits until visible, loads only the root and naturally sorts directories before files', async () => {
  const view = render(<RemoteDirectoryBrowser {...props} visible={false} />)
  expect(files.list).not.toHaveBeenCalled()
  view.rerender(<RemoteDirectoryBrowser {...props} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  expect(requested()).toEqual([root])
  expect(within(tree()).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
    .toEqual(['docs', 'src', '.gitignore', 'file2.txt', 'file10.txt', 'link'])
  expect(row('link')).toBeDisabled()
  fireEvent.click(row('显示隐藏文件'))
  expect(screen.queryByRole('button', { name: '.gitignore' })).toBeNull()
  expect(requested()).toEqual([root])
})

it('expands in place, opens files through the existing callback and marks the selected file', async () => {
  render(<RemoteDirectoryBrowser {...props} selectedPath={`${root}/src/main.ts`} />)
  fireEvent.click(await screen.findByRole('button', { name: 'src', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'main.ts' }))
  expect(pathInput()).toHaveValue(root)
  expect(requested()).toEqual([root, `${root}/src`])
  expect(props.onOpen).toHaveBeenCalledWith(`${root}/src/main.ts`)
  expect(screen.getByRole('treeitem', { name: 'main.ts' })).toHaveAttribute('aria-level', '2')
  expect(screen.getByRole('treeitem', { name: 'main.ts' })).toHaveAttribute('aria-selected', 'true')
})

it('preserves nested expansion across collapse, hide and reopen while revalidating the branch', async () => {
  const view = render(<RemoteDirectoryBrowser {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'src', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'components', exact: true }))
  await screen.findByRole('button', { name: 'App.tsx' })
  fireEvent.click(row('src'))
  expect(screen.queryByRole('button', { name: 'App.tsx' })).toBeNull()
  view.rerender(<RemoteDirectoryBrowser {...props} visible={false} />)
  view.rerender(<RemoteDirectoryBrowser {...props} />)
  expect(row('src')).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(row('src'))
  await screen.findByRole('button', { name: 'App.tsx' })
  await waitFor(() => expect(requested()).toEqual([
    root, `${root}/src`, `${root}/src/components`, `${root}/src`, `${root}/src/components`
  ]))
  expect(pathInput()).toHaveValue(root)
})

it('keeps cached rows during refresh and reloads expanded branches, not collapsed siblings', async () => {
  render(<RemoteDirectoryBrowser {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'src', exact: true }))
  await screen.findByRole('button', { name: 'main.ts' })
  const pending = deferred<RemoteDirectory>()
  files.list.mockImplementationOnce(() => pending.promise)
  fireEvent.click(refresh())
  expect(row('main.ts')).toBeVisible()
  expect(refresh()).toBeDisabled()
  await act(async () => pending.resolve(listings.get(root)!))
  await waitFor(() => expect(refresh()).not.toBeDisabled())
  expect(requested()).toEqual([root, `${root}/src`, root, `${root}/src`])
  expect(row('src')).toHaveAttribute('aria-expanded', 'true')
})

it('deduplicates rapid reopen requests and stops descendant refresh when the panel is hidden', async () => {
  const view = render(<RemoteDirectoryBrowser {...props} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  const pending = deferred<RemoteDirectory>()
  files.list.mockImplementationOnce(() => pending.promise)
  fireEvent.click(row('src'))
  fireEvent.click(row('src'))
  fireEvent.click(row('src'))
  expect(requested()).toEqual([root, `${root}/src`])
  await act(async () => pending.resolve(listings.get(`${root}/src`)!))
  fireEvent.click(await screen.findByRole('button', { name: 'components', exact: true }))
  await screen.findByRole('button', { name: 'App.tsx' })
  const reloading = deferred<RemoteDirectory>()
  files.list.mockImplementationOnce(() => reloading.promise)
  fireEvent.click(refresh())
  view.rerender(<RemoteDirectoryBrowser {...props} visible={false} />)
  const count = files.list.mock.calls.length
  await act(async () => reloading.resolve(listings.get(root)!))
  expect(files.list).toHaveBeenCalledTimes(count)
  view.rerender(<RemoteDirectoryBrowser {...props} />)
  expect(row('App.tsx')).toBeVisible()
})

it('shows per-folder empty, truncated and retry states without removing sibling rows', async () => {
  render(<RemoteDirectoryBrowser {...props} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  files.list.mockRejectedValueOnce(new Error('PERMISSION'))
  fireEvent.click(row('src'))
  expect(await screen.findByRole('alert')).toHaveTextContent('没有访问此路径的权限')
  expect(row('file2.txt')).toBeVisible()
  listings.set(`${root}/src`, directory(`${root}/src`, [item(`${root}/src/main.ts`)], true))
  fireEvent.click(row('重试读取目录'))
  await screen.findByRole('button', { name: 'main.ts' })
  expect(screen.getByText('仅显示前 2000 项')).toBeVisible()
  fireEvent.click(row('docs'))
  expect(await screen.findByText('此文件夹为空')).toBeVisible()
})

it('ignores an old root response after explicit navigation', async () => {
  const pending = deferred<RemoteDirectory>()
  files.list.mockImplementationOnce(() => pending.promise)
  render(<RemoteDirectoryBrowser {...props} initialPath="/old" />)
  fireEvent.change(pathInput(), { target: { value: root } })
  fireEvent.click(row('前往'))
  await screen.findByRole('button', { name: 'src', exact: true })
  await act(async () => pending.resolve(directory('/old', [item('/old/stale.txt')])))
  expect(pathInput()).toHaveValue(root)
  expect(screen.queryByRole('button', { name: 'stale.txt' })).toBeNull()
})

it('isolates pending responses and expansion when the session target changes', async () => {
  const pending = deferred<RemoteDirectory>()
  files.list.mockImplementationOnce(() => pending.promise)
  const view = render(<RemoteDirectoryBrowser {...props} />)
  const next = { ...target, sessionName: 'claude-other' }
  view.rerender(<RemoteDirectoryBrowser {...props} target={next} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  await act(async () => pending.resolve(directory(root, [item(`${root}/stale.txt`)])))
  expect(screen.queryByRole('button', { name: 'stale.txt' })).toBeNull()
  expect(files.list).toHaveBeenLastCalledWith({ ...next, path: root })
})

it('invalidates pending child results when a complete parent refresh removes the child', async () => {
  render(<RemoteDirectoryBrowser {...props} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  const pending = deferred<RemoteDirectory>()
  files.list.mockImplementationOnce(() => pending.promise)
  fireEvent.click(row('src'))
  listings.set(root, directory(root, [item(`${root}/file2.txt`)]))
  fireEvent.click(refresh())
  await waitFor(() => expect(screen.queryByRole('button', { name: 'src', exact: true })).toBeNull())
  await waitFor(() => expect(refresh()).not.toBeDisabled())
  await act(async () => pending.resolve(directory(`${root}/src`, [item(`${root}/src/stale.ts`)])))
  listings.set(root, directory(root, [item(`${root}/src`, 'directory')]))
  fireEvent.click(refresh())
  expect(await screen.findByRole('button', { name: 'src', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(row('src'))
  await screen.findByRole('button', { name: 'main.ts' })
  expect(screen.queryByRole('button', { name: 'stale.ts' })).toBeNull()
})

it('reveals ancestors within the existing root and respects path segment boundaries', async () => {
  const view = render(<RemoteDirectoryBrowser {...props} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  view.rerender(<RemoteDirectoryBrowser {...props}
    selectedPath={`${root}/src/components/App.tsx`}
    location={{ path: `${root}/src/components`, revision: 1 }} />)
  await screen.findByRole('button', { name: 'App.tsx' })
  expect(pathInput()).toHaveValue(root)
  expect(row('src')).toHaveAttribute('aria-expanded', 'true')
  expect(row('components')).toHaveAttribute('aria-expanded', 'true')
  view.rerender(<RemoteDirectoryBrowser {...props}
    location={{ path: '/workspace-other', revision: 2 }} />)
  await waitFor(() => expect(pathInput()).toHaveValue('/workspace-other'))
  expect(files.list).toHaveBeenLastCalledWith({ ...target, path: '/workspace-other' })
})

it('filters expanded entries locally, keeps matching ancestors and permits collapse while filtering', async () => {
  render(<RemoteDirectoryBrowser {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: 'src', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'components', exact: true }))
  await screen.findByRole('button', { name: 'App.tsx' })
  const count = files.list.mock.calls.length
  const filter = screen.getByRole('textbox', { name: '筛选文件名' })
  fireEvent.change(filter, { target: { value: 'app' } })
  expect(row('App.tsx')).toBeVisible()
  expect(row('src')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'main.ts' })).toBeNull()
  expect(files.list).toHaveBeenCalledTimes(count)
  fireEvent.click(row('src'))
  expect(screen.queryByRole('button', { name: 'App.tsx' })).toBeNull()
  expect(screen.getByText('没有匹配的文件')).toBeVisible()
  fireEvent.change(filter, { target: { value: '' } })
  expect(row('src')).toHaveAttribute('aria-expanded', 'false')
})

it('keeps the working root when the first visible render already asks to reveal a nested file', async () => {
  render(<RemoteDirectoryBrowser {...props}
    selectedPath={`${root}/src/components/App.tsx`}
    location={{ path: `${root}/src/components`, revision: 1 }} />)
  await screen.findByRole('button', { name: 'App.tsx' })
  expect(pathInput()).toHaveValue(root)
  expect(requested()).toEqual([root, `${root}/src`, `${root}/src/components`])
})

it('refreshes a cached parent when reveal requests a newly created folder', async () => {
  const view = render(<RemoteDirectoryBrowser {...props} />)
  await screen.findByRole('button', { name: 'src', exact: true })
  listings.set(root, directory(root, [item(`${root}/new`, 'directory')]))
  listings.set(`${root}/new`, directory(`${root}/new`, [item(`${root}/new/fresh.md`)]))
  view.rerender(<RemoteDirectoryBrowser {...props}
    selectedPath={`${root}/new/fresh.md`}
    location={{ path: `${root}/new`, revision: 1 }} />)
  await screen.findByRole('button', { name: 'fresh.md' })
  expect(pathInput()).toHaveValue(root)
  expect(requested()).toEqual([root, root, `${root}/new`])
})

it('supports roving keyboard navigation, arrow expansion and collapse-all', async () => {
  render(<RemoteDirectoryBrowser {...props} />)
  const src = await screen.findByRole('button', { name: 'src', exact: true })
  act(() => src.focus())
  fireEvent.keyDown(src, { key: 'ArrowLeft' })
  expect(src).toHaveAttribute('tabindex', '0')
  fireEvent.keyDown(src, { key: 'ArrowRight' })
  const components = await screen.findByRole('button', { name: 'components', exact: true })
  fireEvent.keyDown(src, { key: 'ArrowRight' })
  expect(components).toHaveFocus()
  fireEvent.keyDown(components, { key: 'ArrowLeft' })
  expect(src).toHaveFocus()
  fireEvent.keyDown(src, { key: 'End' })
  expect(row('file10.txt')).toHaveFocus()
  fireEvent.keyDown(row('file10.txt'), { key: 'Home' })
  expect(row('docs')).toHaveFocus()
  fireEvent.click(row('全部折叠'))
  expect(src).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('button', { name: 'components', exact: true })).toBeNull()
})

it('loads correctly under StrictMode and canonicalizes the returned root path', async () => {
  files.list.mockImplementation(async () => listings.get(root)!)
  render(<StrictMode>
    <RemoteDirectoryBrowser {...props} initialPath="~/project" />
  </StrictMode>)
  await screen.findByRole('button', { name: 'src', exact: true })
  expect(pathInput()).toHaveValue(root)
  expect(screen.queryByRole('alert')).toBeNull()
})
