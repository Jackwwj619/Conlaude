import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CreateSessionDialog } from '../../src/renderer/src/components/CreateSessionDialog'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { RemoteDirectory } from '../../src/shared/remote-files'

const profiles = [
  DEFAULT_SETTINGS.profiles[0]!,
  {
    ...DEFAULT_SETTINGS.profiles[0]!,
    id: 'exp',
    label: 'Experiment',
    defaultCwd: '/srv/exp',
    defaultSession: 'experiment'
  }
]
const list = vi.fn()
const listing = (path: string): RemoteDirectory => ({
  path,
  parent: '/',
  truncated: false,
  entries: [
    { name: '项目', path: `${path}/项目`, kind: 'directory', size: 0, modified: 0 },
    { name: 'README.md', path: `${path}/README.md`, kind: 'file', size: 5, modified: 0 }
  ]
})
beforeEach(() => {
  list.mockReset().mockImplementation(async ({ path }) => listing(path))
  vi.stubGlobal('claudeBridge', { files: { list } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps per-server drafts and submits the chosen server with a manually entered path and tmux name', async () => {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  render(
    <CreateSessionDialog
      profiles={profiles}
      initialProfileId="mas"
      onCreate={onCreate}
      onClose={vi.fn()}
    />
  )
  expect(screen.getByLabelText('tmux 会话名')).toBeVisible()
  fireEvent.change(screen.getByLabelText('远程工作目录'), { target: { value: '/saved/mas' } })
  fireEvent.change(screen.getByLabelText('tmux 会话名'), { target: { value: 'mas-draft' } })
  fireEvent.change(screen.getByLabelText('服务器'), { target: { value: 'exp' } })
  expect(screen.getByLabelText('远程工作目录')).toHaveValue('/srv/exp')
  expect((screen.getByLabelText('tmux 会话名') as HTMLInputElement).value).toMatch(/^experiment-/)
  fireEvent.change(screen.getByLabelText('远程工作目录'), {
    target: { value: ' /srv/中文 project ' }
  })
  fireEvent.change(screen.getByLabelText('tmux 会话名'), { target: { value: ' custom-exp ' } })
  fireEvent.change(screen.getByLabelText('服务器'), { target: { value: 'mas' } })
  expect(screen.getByLabelText('远程工作目录')).toHaveValue('/saved/mas')
  expect(screen.getByLabelText('tmux 会话名')).toHaveValue('mas-draft')
  fireEvent.change(screen.getByLabelText('服务器'), { target: { value: 'exp' } })
  fireEvent.click(screen.getByRole('button', { name: '创建并连接' }))
  await waitFor(() =>
    expect(onCreate).toHaveBeenCalledWith(
      { profileId: 'exp', sessionName: 'custom-exp', cwd: '/srv/中文 project' },
      ''
    )
  )
  expect(list).not.toHaveBeenCalled()
})

it('browses directories before any session exists and selects the resolved path', async () => {
  render(
    <CreateSessionDialog
      profiles={profiles}
      initialProfileId="exp"
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }))
  fireEvent.click(await screen.findByRole('button', { name: '项目' }))
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith({ profileId: 'exp', path: '/srv/exp/项目' })
  )
  expect(screen.queryByRole('button', { name: 'README.md' })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '选择当前文件夹' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '选择当前文件夹' }))
  expect(screen.getByLabelText('远程工作目录')).toHaveValue('/srv/exp/项目')
  expect(screen.queryByRole('region', { name: '浏览文件夹' })).not.toBeInTheDocument()
})

it('ignores a slow listing from a previously selected server', async () => {
  let finish!: (value: RemoteDirectory) => void
  list.mockImplementationOnce(
    () =>
      new Promise<RemoteDirectory>((resolve) => {
        finish = resolve
      })
  )
  render(
    <CreateSessionDialog
      profiles={profiles}
      initialProfileId="mas"
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }))
  fireEvent.change(screen.getByLabelText('服务器'), { target: { value: 'exp' } })
  await screen.findByRole('button', { name: '项目' })
  await act(async () => finish(listing('/wrong-server')))
  fireEvent.click(screen.getByRole('button', { name: '选择当前文件夹' }))
  expect(screen.getByLabelText('远程工作目录')).toHaveValue('/srv/exp')
})

it('allows manual input after browse failure and retains values after a duplicate-name error', async () => {
  list.mockRejectedValue(new Error('PERMISSION'))
  const onCreate = vi.fn().mockRejectedValue(new Error('tmux session already exists'))
  const onClose = vi.fn()
  render(
    <CreateSessionDialog
      profiles={profiles}
      initialProfileId="exp"
      onCreate={onCreate}
      onClose={onClose}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('可重试，或直接输入工作目录')
  fireEvent.change(screen.getByLabelText('远程工作目录'), { target: { value: '~/manual' } })
  fireEvent.change(screen.getByLabelText('tmux 会话名'), { target: { value: 'bad name' } })
  expect(screen.getByRole('button', { name: '创建并连接' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('tmux 会话名'), { target: { value: 'existing' } })
  fireEvent.click(screen.getByRole('button', { name: '创建并连接' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('tmux session already exists')
  expect(screen.getByLabelText('远程工作目录')).toHaveValue('~/manual')
  expect(onClose).not.toHaveBeenCalled()
})
