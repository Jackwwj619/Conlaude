import { beforeEach, expect, it, vi } from 'vitest'
import { RemoteFiles } from '../../src/main/remote-files'
import { SshClient } from '../../src/main/ssh-client'
import type { HelperManager } from '../../src/main/helper-manager'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { runProcess } from '../../src/main/process-runner'
import { mkdtemp, readFile, writeFile, readdir, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DirectoryRequestSchema,
  FileRequestSchema,
  SaveFileRequestSchema
} from '../../src/shared/remote-files'

vi.mock('../../src/main/process-runner', () => ({ runProcess: vi.fn() }))
const profile = DEFAULT_SETTINGS.profiles[0]!
const request = {
  profileId: profile.id,
  sessionName: 'claude-review',
  path: "/tmp/中文 '$(id).txt",
  content: '你好\n',
  version: 'a'.repeat(64)
}
const status = vi.fn()
const install = vi.fn()
const helper = { status, install } as unknown as HelperManager
beforeEach(() => {
  vi.clearAllMocks()
  status.mockResolvedValue({ installed: true })
  vi.mocked(runProcess).mockResolvedValue({
    exitCode: 0,
    stderr: '',
    stdout: JSON.stringify({ ok: true, value: { content: '你好' } })
  })
})

it('passes file paths and contents only on stdin and checks the helper once', async () => {
  const files = new RemoteFiles(new SshClient(), helper)
  await files.execute(profile, 'read', request)
  await files.execute(profile, 'save', request)
  expect(status).toHaveBeenCalledTimes(1)
  expect(install).not.toHaveBeenCalled()
  const [, args, options] = vi.mocked(runProcess).mock.calls[1]!
  expect(args.join(' ')).not.toContain(request.path)
  expect(args.join(' ')).not.toContain(request.content)
  expect(JSON.parse(options!.input!)).toEqual(request)
})

it('rejects oversized UTF-8 before making a connection', async () => {
  const files = new RemoteFiles(new SshClient(), helper)
  await expect(
    files.execute(profile, 'save', { ...request, content: '界'.repeat(400000) })
  ).rejects.toThrow('TOO_LARGE')
  expect(status).not.toHaveBeenCalled()
  expect(runProcess).not.toHaveBeenCalled()
})

it('rechecks write authorization after helper preparation', async () => {
  const files = new RemoteFiles(new SshClient(), helper)
  await expect(
    files.execute(profile, 'save', request, () => {
      throw new Error('READ_ONLY')
    })
  ).rejects.toThrow('READ_ONLY')
  expect(runProcess).not.toHaveBeenCalled()
})

it('propagates conflicts without automatically retrying a write', async () => {
  vi.mocked(runProcess).mockResolvedValue({
    exitCode: 0,
    stderr: '',
    stdout: '{"ok":false,"error":"CONFLICT"}'
  })
  const files = new RemoteFiles(new SshClient(), helper)
  await expect(files.execute(profile, 'save', request)).rejects.toThrow('CONFLICT')
  expect(runProcess).toHaveBeenCalledTimes(1)
})

it('requires a version and rejects NUL paths at the IPC boundary', () => {
  expect(SaveFileRequestSchema.safeParse({ ...request, version: '' }).success).toBe(false)
  expect(SaveFileRequestSchema.safeParse({ ...request, path: '/tmp/a\0b' }).success).toBe(false)
})

it.each([true, false])(
  'downloads exact binary files and preserves the destination on failure (success=%s)',
  async (success) => {
    const directory = await mkdtemp(join(tmpdir(), 'clb-download-test-'))
    const destination = join(directory, 'download.bin')
    await writeFile(destination, 'existing')
    const content = Buffer.from([0, 255, 128, 65])
    try {
      vi.mocked(runProcess).mockImplementationOnce(async (_command, args) => {
        expect(args.at(-2)).toContain('/tmp/a\\[1\\]\\*.bin')
        expect(args.at(-1)).not.toBe(destination)
        await writeFile(args.at(-1)!, content)
        return { exitCode: success ? 0 : 1, stdout: '', stderr: success ? '' : 'disconnected' }
      })
      const download = new RemoteFiles(new SshClient(), helper).download(
        profile,
        '/tmp/a[1]*.bin',
        destination
      )
      if (success) await download
      else await expect(download).rejects.toThrow('disconnected')
      expect(await readFile(destination)).toEqual(success ? content : Buffer.from('existing'))
      expect(await readdir(directory)).toEqual(['download.bin'])
    } finally {
      await unlink(destination)
      await rmdir(directory)
    }
  }
)

it('rejects relative download paths before transfer', async () => {
  await expect(
    new RemoteFiles(new SshClient(), helper).download(profile, '-unsafe', '/unused')
  ).rejects.toThrow('INVALID_PATH')
  expect(runProcess).not.toHaveBeenCalled()
})

it('lists directories with just a server and path while file reads and saves still require a session', async () => {
  const browse = DirectoryRequestSchema.parse({ profileId: profile.id, path: '~/projects' })
  expect(FileRequestSchema.safeParse(browse).success).toBe(false)
  expect(
    SaveFileRequestSchema.safeParse({ ...browse, content: '', version: 'a'.repeat(64) }).success
  ).toBe(false)
  const files = new RemoteFiles(new SshClient(), helper)
  await files.execute(profile, 'list', browse)
  expect(JSON.parse(vi.mocked(runProcess).mock.calls[0]![2]!.input!)).toEqual(browse)
})
