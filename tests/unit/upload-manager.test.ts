// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { dialog, nativeImage } from 'electron'
import { UploadManager } from '../../src/main/upload-manager'
import { runProcess } from '../../src/main/process-runner'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { SshClient } from '../../src/main/ssh-client'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn() }
}))
vi.mock('../../src/main/process-runner', () => ({ runProcess: vi.fn() }))
vi.mock('../../src/main/logger', () => ({ logger: { warn: vi.fn() } }))

const root = resolve('test-results')
await mkdir(root, { recursive: true })
const directory = await mkdtemp(resolve(root, 'upload-unit-'))
const filename = resolve(directory, '中文 报告.csv')
const target = { profileId: 'mas', sessionName: 'test-upload' }
const profile = DEFAULT_SETTINGS.profiles[0]!

beforeEach(async () => {
  vi.clearAllMocks()
  await writeFile(filename, '')
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [filename] })
  vi.mocked(runProcess).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
})
afterAll(async () => {
  const path = relative(root, directory)
  if (!path.startsWith('upload-unit-') || path.includes('..'))
    throw new Error('Unexpected test directory')
  await rm(directory, { recursive: true, force: true })
})
function setup() {
  const ssh = {
    scpPath: 'scp.exe',
    run: vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValue({ exitCode: 0, stdout: '/home/test', stderr: '' })
  }
  const progress = vi.fn()
  const manager = new UploadManager(() => undefined, ssh as unknown as SshClient, progress)
  return { manager, ssh, progress }
}

describe('upload task feedback', () => {
  it('cleans up its temporary clipboard file after a failed transfer', async () => {
    vi.mocked(nativeImage.createFromDataURL).mockReturnValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('test-image')
    } as ReturnType<typeof nativeImage.createFromDataURL>)
    vi.mocked(runProcess).mockRejectedValueOnce(new Error('transfer failed'))
    const { manager } = setup()
    await expect(
      manager.uploadImage(profile, target, 'zh-CN', 'data:image/png;base64,dGVzdA==')
    ).rejects.toThrow('transfer failed')
    const args = vi.mocked(runProcess).mock.calls[0]![1] as string[]
    const localPath = args[args.length - 2]!
    const { stat } = await import('node:fs/promises')
    await expect(stat(localPath)).rejects.toThrow()
  })
  it('rejects non-image payloads without starting a remote upload', async () => {
    const { manager, ssh } = setup()
    await expect(
      manager.uploadImage(profile, target, 'zh-CN', 'file:///etc/passwd')
    ).rejects.toThrow('Invalid clipboard image')
    expect(ssh.run).not.toHaveBeenCalled()
  })
  it('uploads zero-byte Chinese filenames and reports all stages against the original target', async () => {
    const { manager, progress } = setup()
    const result = await manager.chooseAndUpload(profile, target, 'zh-CN')
    expect(result).toMatchObject({ canceled: false, localPath: filename, bytes: 0 })
    expect(result.remotePath).toMatch(/\/test-upload\/\d+-中文_报告\.csv$/)
    expect(progress.mock.calls.map(([, event]) => event.stage)).toEqual([
      'preparing',
      'transferring',
      'resolving',
      'complete'
    ])
    for (const [actualTarget, event] of progress.mock.calls) {
      expect(actualTarget).toEqual(target)
      expect(event).toMatchObject({ filename: '中文 报告.csv', bytes: 0 })
    }
  })
  it('rejects files above the limit before making any remote requests', async () => {
    const file = await open(filename, 'r+')
    try {
      await file.truncate(100 * 1024 * 1024 + 1)
    } finally {
      await file.close()
    }
    const { manager, ssh, progress } = setup()
    await expect(manager.chooseAndUpload(profile, target, 'zh-CN')).rejects.toThrow('100 MB')
    expect(ssh.run).not.toHaveBeenCalled()
    expect(runProcess).not.toHaveBeenCalled()
    expect(progress.mock.lastCall?.[1]).toMatchObject({
      stage: 'failed',
      filename: '中文 报告.csv'
    })
  })
  it('reports transfer failures and does not resolve or insert a remote path', async () => {
    vi.mocked(runProcess).mockRejectedValueOnce(new Error('Connection reset'))
    const { manager, ssh, progress } = setup()
    await expect(manager.chooseAndUpload(profile, target, 'zh-CN')).rejects.toThrow(
      'Connection reset'
    )
    expect(ssh.run).toHaveBeenCalledTimes(1)
    expect(progress.mock.calls.map(([, event]) => event.stage)).toEqual([
      'preparing',
      'transferring',
      'failed'
    ])
  })
  it('distinguishes uploaded files whose remote path could not be resolved', async () => {
    const { manager, ssh, progress } = setup()
    ssh.run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
    await expect(manager.chooseAndUpload(profile, target, 'zh-CN')).rejects.toThrow('文件已上传')
    expect(progress.mock.lastCall?.[1].stage).toBe('failed')
  })
  it('does nothing when the file picker is canceled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    const { manager, ssh, progress } = setup()
    expect(await manager.chooseAndUpload(profile, target, 'zh-CN')).toEqual({ canceled: true })
    expect(ssh.run).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
  })
})
