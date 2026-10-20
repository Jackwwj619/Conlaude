import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Profile } from '../shared/contracts'
import { logger } from './logger'
import { runProcess } from './process-runner'
import { scpArgsFor, SshClient } from './ssh-client'

const REMOTE_DIRECTORY = '~/.local/share/claude-local-bridge'
const REMOTE_HELPER = `${REMOTE_DIRECTORY}/bridge_agent.py`
const REMOTE_TEMP = `${REMOTE_DIRECTORY}/bridge_agent.py.tmp`

interface HealthResponse {
  ok: boolean
  bridgeVersion: string
}

export class HelperManager {
  constructor(private readonly ssh: SshClient) {}

  localHelperPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'remote', 'bridge_agent.py')
      : join(app.getAppPath(), 'remote', 'bridge_agent.py')
  }

  private async localVersion(): Promise<string | undefined> {
    try {
      const source = await readFile(this.localHelperPath(), 'utf8')
      return source.match(/^VERSION\s*=\s*["']([^"']+)["']/m)?.[1]
    } catch {
      return undefined
    }
  }

  async status(
    profile: Profile
  ): Promise<{ installed: boolean; version?: string; detail: string }> {
    const result = await this.ssh.runHelper(
      profile,
      ['health', '--claude-path', profile.claudePath],
      12000
    )
    if (result.exitCode !== 0) {
      return {
        installed: false,
        detail: result.stderr.trim() || 'Remote helper is not installed'
      }
    }
    try {
      const health = JSON.parse(result.stdout.trim()) as HealthResponse
      const localVersion = await this.localVersion()
      if (health.ok === true && localVersion && health.bridgeVersion !== localVersion) {
        return {
          installed: false,
          version: health.bridgeVersion,
          detail: `Remote helper update required; bundled version is ${localVersion}`
        }
      }
      return {
        installed: health.ok === true,
        version: health.bridgeVersion,
        detail: health.ok ? 'Remote helper is healthy' : 'Remote helper reported an error'
      }
    } catch {
      return { installed: false, detail: 'Remote helper returned invalid JSON' }
    }
  }

  async install(profile: Profile): Promise<{ version: string; sha256: string }> {
    const localPath = this.localHelperPath()
    const contents = await readFile(localPath)
    const sha256 = createHash('sha256').update(contents).digest('hex')

    const mkdir = await this.ssh.run(
      profile,
      `mkdir -p ${REMOTE_DIRECTORY} && chmod 700 ${REMOTE_DIRECTORY}`
    )
    if (mkdir.exitCode !== 0)
      throw new Error(mkdir.stderr.trim() || 'Unable to create helper directory')

    const upload = await runProcess(this.ssh.scpPath, scpArgsFor(profile, localPath, REMOTE_TEMP), {
      timeoutMs: 60000
    })
    if (upload.exitCode !== 0)
      throw new Error(upload.stderr.trim() || 'Unable to upload remote helper')

    const remoteHash = await this.ssh.run(profile, `sha256sum ${REMOTE_TEMP}`)
    if (remoteHash.exitCode !== 0 || remoteHash.stdout.split(/\s+/)[0] !== sha256) {
      await this.ssh.run(profile, `rm -f ${REMOTE_TEMP}`)
      throw new Error('Remote helper checksum verification failed')
    }

    const activate = await this.ssh.run(
      profile,
      `if [ -f ${REMOTE_HELPER} ]; then cp ${REMOTE_HELPER} ${REMOTE_HELPER}.previous; fi && chmod 700 ${REMOTE_TEMP} && mv ${REMOTE_TEMP} ${REMOTE_HELPER}`
    )
    if (activate.exitCode !== 0)
      throw new Error(activate.stderr.trim() || 'Unable to activate remote helper')

    const status = await this.status(profile)
    if (!status.installed || !status.version) throw new Error(status.detail)
    logger.info(`Installed remote helper ${status.version} for profile ${profile.id}`)
    return { version: status.version, sha256 }
  }
}
