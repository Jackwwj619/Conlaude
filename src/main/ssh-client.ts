import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { Profile, SshConfigEntry, SshConfigFile } from '../shared/contracts'
import { runProcess, type ProcessResult } from './process-runner'
import { logger } from './logger'

const SSH_OPTIONS = [
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3'
]

export function systemOpenSshPath(binary: 'ssh' | 'scp'): string {
  const windowsDirectory = process.env.WINDIR ?? 'C:\\Windows'
  const candidate = join(windowsDirectory, 'System32', 'OpenSSH', `${binary}.exe`)
  return existsSync(candidate) ? candidate : `${binary}.exe`
}

export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new Error('NUL is not allowed in a remote argument')
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function helperCommand(args: string[]): string {
  return [
    'python3',
    '~/.local/share/claude-local-bridge/bridge_agent.py',
    ...args.map(shellQuote)
  ].join(' ')
}

export function executableCheck(command: string): string {
  const value = command.trim()
  if (value.includes('/')) {
    const path = value.startsWith('~/')
      ? `"$HOME"/${shellQuote(value.slice(2))}`
      : shellQuote(value)
    return `test -x ${path}`
  }
  return `bash -lic ${shellQuote(`type -t -- ${shellQuote(value)} >/dev/null`)} 2>/dev/null`
}

export function sshTarget(profile: Profile): string {
  if (profile.sshHost) return profile.sshHost
  return profile.user ? `${profile.user}@${profile.host}` : profile.host
}

export function sshArgsFor(profile: Profile, remoteCommand?: string): string[] {
  if (profile.sshHost) {
    const args = [profile.sshHost]
    if (remoteCommand) args.push(remoteCommand)
    return args
  }

  const args: string[] = []
  if (profile.port !== 22) {
    args.push('-p', String(profile.port))
  }
  if (profile.authMode === 'key' && profile.privateKeyPath) {
    args.push('-i', profile.privateKeyPath)
  }
  if (profile.authMode === 'agent') {
    args.push('-o', 'ForwardAgent=yes')
  }
  if (profile.proxyJump) {
    args.push('-J', profile.proxyJump)
  }
  args.push(sshTarget(profile))
  if (remoteCommand) args.push(remoteCommand)
  return args
}

export function scpArgsFor(profile: Profile, localPath: string, remotePath: string): string[] {
  // Reuse SSH's effective connection options; scp spells the port flag with a capital P.
  const args = sshArgsFor(profile)
  args.pop()
  if (!profile.sshHost && profile.port !== 22) args[0] = '-P'
  const host = profile.host.includes(':') ? `[${profile.host}]` : profile.host
  const target = profile.sshHost ?? (profile.user ? `${profile.user}@${host}` : host)
  return [
    '-q',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    ...args,
    '--',
    localPath,
    `${target}:${remotePath}`
  ]
}

export function parseSshConfig(content: string): SshConfigEntry[] {
  const entries: SshConfigEntry[] = []
  let current: SshConfigEntry[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(\S+)\s+(.+)$/.exec(line)
    if (!match) continue
    const key = match[1]?.toLocaleLowerCase()
    const value = match[2]?.trim()
    if (!key || !value) continue

    if (key === 'host') {
      current = value
        .split(/\s+/)
        .filter((host) => !host.startsWith('!') && !/[?*]/.test(host))
        .map((host) => ({ host }))
      entries.push(...current)
      continue
    }
    if (!current.length) continue

    for (const entry of current) {
      if (key === 'hostname') entry.hostName = value
      else if (key === 'user') entry.user = value
      else if (key === 'port') entry.port = Number(value) || undefined
      else if (key === 'identityfile') {
        entry.identityFile = value.startsWith('~') ? join(homedir(), value.slice(1)) : value
      } else if (key === 'identitiesonly') {
        const normalized = value.toLocaleLowerCase()
        entry.identitiesOnly = normalized === 'yes' || normalized === 'true'
      } else if (key === 'proxyjump') entry.proxyJump = value
    }
  }

  return entries
}

export async function parseSshConfigFile(path: string): Promise<SshConfigEntry[]> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return []
  }
  return parseSshConfig(content)
}

export class SshClient {
  readonly sshPath = systemOpenSshPath('ssh')
  readonly scpPath = systemOpenSshPath('scp')

  sshConfigPath(): string {
    return join(homedir(), '.ssh', 'config')
  }

  async getSshConfig(): Promise<SshConfigFile> {
    const path = this.sshConfigPath()
    let content = ''
    try {
      content = await readFile(path, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
    return { path, content, entries: parseSshConfig(content) }
  }

  async saveSshConfig(content: string): Promise<SshConfigFile> {
    const path = this.sshConfigPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
    return { path, content, entries: parseSshConfig(content) }
  }

  async expandedConfig(profile: Profile): Promise<Record<string, string[]>> {
    const result = await runProcess(this.sshPath, ['-G', ...sshArgsFor(profile)], {
      timeoutMs: 10000
    })
    if (result.exitCode !== 0)
      throw new Error(result.stderr.trim() || 'Unable to resolve SSH profile')

    const parsed: Record<string, string[]> = {}
    for (const line of result.stdout.split(/\r?\n/)) {
      const space = line.indexOf(' ')
      if (space < 1) continue
      const key = line.slice(0, space).toLowerCase()
      const value = line.slice(space + 1).trim()
      parsed[key] = [...(parsed[key] ?? []), value]
    }
    return parsed
  }

  async run(profile: Profile, remoteCommand: string, timeoutMs = 15000): Promise<ProcessResult> {
    return await runProcess(
      this.sshPath,
      [...SSH_OPTIONS, '-o', 'BatchMode=yes', ...sshArgsFor(profile, remoteCommand)],
      { timeoutMs }
    )
  }

  async runHelper(profile: Profile, args: string[], timeoutMs = 15000): Promise<ProcessResult> {
    return await this.run(profile, helperCommand(args), timeoutMs)
  }

  interactiveArgs(profile: Profile, remoteCommand: string): string[] {
    return ['-tt', ...SSH_OPTIONS, ...sshArgsFor(profile, remoteCommand)]
  }

  watchArgs(profile: Profile, remoteCommand: string): string[] {
    return ['-o', 'BatchMode=yes', ...SSH_OPTIONS, ...sshArgsFor(profile, remoteCommand)]
  }

  async preflight(profile: Profile): Promise<ProcessResult> {
    return await this.run(profile, "printf '%s' CLB_SSH_OK", 15000)
  }

  async testProfile(profile: Profile): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.preflight(profile)
      if (result.exitCode === 0 && result.stdout.includes('CLB_SSH_OK')) {
        return { ok: true, message: '连接成功' }
      }
      return {
        ok: false,
        message: result.stderr.trim() || result.stdout.trim() || `SSH 退出码 ${result.exitCode}`
      }
    } catch (error) {
      logger.warn(
        `SSH profile test failed: ${error instanceof Error ? error.message : String(error)}`
      )
      return {
        ok: false,
        message: error instanceof Error ? error.message : '连接测试失败'
      }
    }
  }

  async importSshConfig(): Promise<SshConfigEntry[]> {
    return (await this.getSshConfig()).entries
  }
}
