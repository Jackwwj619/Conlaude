import { app } from 'electron'
import { existsSync } from 'node:fs'
import type { DiagnosticCheck, DiagnosticReport, Profile } from '../shared/contracts'
import type { HelperManager } from './helper-manager'
import { executableCheck, type SshClient } from './ssh-client'

const labels: Record<string, string> = {
  app: 'Conlaude',
  'ssh-binary': 'Windows OpenSSH',
  'ssh-profile': 'SSH configuration',
  'ssh-connectivity': 'SSH connectivity',
  'remote-helper': 'Remote helper',
  'remote-tools': 'Remote tmux and Claude'
}
const safeDetails: Record<string, string> = {
  ok: 'Check passed.',
  missing: 'Required component is unavailable.',
  configuration: 'SSH configuration could not be resolved.',
  timeout: 'Operation timed out. Check connectivity and retry.',
  authentication: 'SSH authentication failed. Check the SSH user and key configuration.',
  hostKey: 'SSH host key verification failed. Verify the server identity before reconnecting.',
  connection: 'SSH connection failed. Check the network and SSH configuration.',
  error: 'Check failed. Inspect the detailed report locally.',
  skipped: 'Skipped because an earlier prerequisite failed.'
}

/** Export an allowlist: raw command output may contain arbitrary credentials and paths. */
export function redactDiagnosticReport(report: DiagnosticReport): DiagnosticReport {
  return {
    generatedAt: report.generatedAt,
    complete: report.complete,
    elapsedMs: report.elapsedMs,
    checks: report.checks
      .filter((check) => Object.hasOwn(labels, check.id))
      .map((check) => ({
        id: check.id,
        label: labels[check.id]!,
        status: check.status,
        code: Object.hasOwn(safeDetails, check.code ?? '') ? check.code : 'error',
        detail: safeDetails[check.code ?? ''] ?? safeDetails.error!
      }))
  }
}
function failureCode(detail: string): string {
  if (/timed? out|timeout/i.test(detail)) return 'timeout'
  if (/permission denied|authentication/i.test(detail)) return 'authentication'
  if (/host key|identification has changed/i.test(detail)) return 'hostKey'
  return 'connection'
}

export class Diagnostics {
  private readonly reports = new Map<string, { signature: string; report: DiagnosticReport }>()
  private readonly pending = new Map<string, Promise<DiagnosticReport>>()
  constructor(
    private readonly ssh: SshClient,
    private readonly helper: HelperManager,
    private readonly progress?: (profileId: string, report: DiagnosticReport) => void
  ) {}
  latest(profile: Profile): DiagnosticReport | undefined {
    const saved = this.reports.get(profile.id)
    return saved?.signature === JSON.stringify(profile) ? saved.report : undefined
  }
  run(profile: Profile): Promise<DiagnosticReport> {
    const key = JSON.stringify(profile)
    const pending = this.pending.get(key)
    if (pending) return pending
    const request = this.inspect(profile).finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }
  private async inspect(profile: Profile): Promise<DiagnosticReport> {
    const started = Date.now()
    const generatedAt = new Date().toISOString()
    const checks: DiagnosticCheck[] = []
    const publish = (activeCheck?: string, complete = false): DiagnosticReport => {
      const report = {
        generatedAt,
        checks: [...checks],
        elapsedMs: Date.now() - started,
        activeCheck,
        complete
      }
      this.reports.set(profile.id, { signature: JSON.stringify(profile), report })
      if (this.reports.size > 100) this.reports.delete(this.reports.keys().next().value!)
      this.progress?.(profile.id, report)
      return report
    }
    const check = async (
      id: string,
      run: () => Promise<Pick<DiagnosticCheck, 'status' | 'detail' | 'code'>>
    ): Promise<boolean> => {
      publish(id)
      try {
        checks.push({ id, label: labels[id]!, ...(await run()) })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        checks.push({ id, label: labels[id]!, status: 'error', detail, code: failureCode(detail) })
      }
      publish()
      return checks.at(-1)!.status === 'ok'
    }
    const skip = (id: string): void => {
      checks.push({
        id,
        label: labels[id]!,
        status: 'skipped',
        code: 'skipped',
        detail: safeDetails.skipped!
      })
      publish()
    }
    await check('app', async () => ({
      status: 'ok',
      code: 'ok',
      detail: `Version ${app.getVersion()}, Electron ${process.versions.electron}, Node ${process.versions.node}`
    }))
    const binary = await check('ssh-binary', async () =>
      existsSync(this.ssh.sshPath)
        ? { status: 'ok', code: 'ok', detail: 'System ssh.exe is available' }
        : { status: 'error', code: 'missing', detail: 'System ssh.exe was not found' }
    )
    let connected = false
    if (binary) {
      await check('ssh-profile', async () => {
        const expanded = await this.ssh.expandedConfig(profile)
        const host = expanded.hostname?.[0],
          user = expanded.user?.[0]
        return host && user
          ? { status: 'ok', code: 'ok', detail: `Resolves to ${user}@${host}` }
          : {
              status: 'warning',
              code: 'configuration',
              detail: 'Profile resolved without host/user metadata'
            }
      })
      connected = await check('ssh-connectivity', async () => {
        const result = await this.ssh.preflight(profile)
        if (result.exitCode === 0 && result.stdout.includes('CLB_SSH_OK'))
          return { status: 'ok', code: 'ok', detail: 'Authenticated connection succeeded' }
        const detail = result.stderr.trim() || 'SSH connection failed'
        return { status: 'error', code: failureCode(detail), detail }
      })
    } else {
      skip('ssh-profile')
      skip('ssh-connectivity')
    }
    if (connected) {
      await check('remote-helper', async () => {
        const helper = await this.helper.status(profile)
        return {
          status: helper.installed ? 'ok' : 'warning',
          code: helper.installed ? 'ok' : 'missing',
          detail: `${helper.detail ?? ''}${helper.version ? ` (${helper.version})` : ''}`
        }
      })
      await check('remote-tools', async () => {
        const result = await this.ssh.run(
          profile,
          `if command -v tmux >/dev/null && ${executableCheck(profile.claudePath)}; then printf '%s' READY; else printf '%s' MISSING; fi`
        )
        const ready = result.exitCode === 0 && result.stdout.includes('READY')
        return {
          status: ready ? 'ok' : 'error',
          code: ready ? 'ok' : 'missing',
          detail: ready
            ? 'tmux and Claude are available'
            : result.stderr.trim() || 'tmux or Claude is unavailable'
        }
      })
    } else {
      skip('remote-helper')
      skip('remote-tools')
    }
    return publish(undefined, true)
  }
}
