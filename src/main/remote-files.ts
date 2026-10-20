import type { Profile } from '../shared/contracts'
import { mkdtemp, rename, unlink, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  type DirectoryRequest,
  type SaveFileRequest
} from '../shared/remote-files'
import { connectionIdentity } from '../shared/profile-identity'
import type { HelperManager } from './helper-manager'
import { helperCommand, scpArgsFor, type SshClient } from './ssh-client'
import { runProcess } from './process-runner'

/** Short-lived SSH requests only; no watchers, index or extra remote service. */
export class RemoteFiles {
  private ready = new Map<string, Promise<void>>()
  private saving = new Set<string>()
  constructor(
    private ssh: SshClient,
    private helper: HelperManager
  ) {}

  async download(profile: Profile, remotePath: string, destination: string): Promise<void> {
    if (
      (!remotePath.startsWith('/') && !remotePath.startsWith('~/')) ||
      /[\0\r\n]/.test(remotePath)
    )
      throw new Error('INVALID_PATH')
    // Stage beside the destination so a failed transfer never replaces an existing file.
    const directory = await mkdtemp(join(dirname(destination), '.clb-download-'))
    const temporary = join(directory, 'download')
    try {
      // SCP's SFTP source uses glob patterns; quote metacharacters to select exactly one file.
      const literalPath = remotePath.replace(/([\\*?[\]])/g, '\\$1')
      const uploadArgs = scpArgsFor(profile, temporary, literalPath)
      const result = await runProcess(
        this.ssh.scpPath,
        [...uploadArgs.slice(0, -2), uploadArgs.at(-1)!, temporary],
        { timeoutMs: 300000 }
      )
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'IO_ERROR')
      await rename(temporary, destination)
    } finally {
      await unlink(temporary).catch(() => undefined)
      await rmdir(directory).catch(() => undefined)
    }
  }

  async execute(
    profile: Profile,
    operation: 'list' | 'read' | 'save',
    request: DirectoryRequest | SaveFileRequest,
    authorize: () => void = () => undefined
  ): Promise<unknown> {
    if ('content' in request && Buffer.byteLength(request.content, 'utf8') > MAX_TEXT_BYTES)
      throw new Error('TOO_LARGE')
    const identity = connectionIdentity(profile)
    let ready = this.ready.get(identity)
    if (!ready) {
      ready = (async () => {
        if (!(await this.helper.status(profile)).installed) await this.helper.install(profile)
      })().catch((error: unknown) => {
        this.ready.delete(identity)
        throw error
      })
      this.ready.set(identity, ready)
    }
    await ready
    authorize()
    const key = `${identity}\0${request.path}`
    if (operation === 'save' && this.saving.has(key)) throw new Error('BUSY')
    if (operation === 'save') this.saving.add(key)
    try {
      const result = await runProcess(
        this.ssh.sshPath,
        this.ssh.watchArgs(profile, helperCommand(['files', operation])),
        {
          input: JSON.stringify(request),
          timeoutMs: 30000,
          maxOutputBytes:
            operation === 'read'
              ? Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + MAX_TEXT_BYTES
              : 8 * MAX_TEXT_BYTES
        }
      )
      if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'IO_ERROR')
      const response = JSON.parse(result.stdout) as { ok: boolean; value?: unknown; error?: string }
      if (!response.ok) throw new Error(response.error || 'IO_ERROR')
      return response.value
    } finally {
      if (operation === 'save') this.saving.delete(key)
    }
  }
}
