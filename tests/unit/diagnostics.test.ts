import { describe, expect, it, vi } from 'vitest'
import { Diagnostics, redactDiagnosticReport } from '../../src/main/diagnostics'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { SshClient } from '../../src/main/ssh-client'
import type { HelperManager } from '../../src/main/helper-manager'

vi.mock('electron', () => ({ app: { getVersion: () => '1.0.3' } }))
vi.mock('../../src/main/logger', () => ({ logger: { warn: vi.fn() } }))

function setup() {
  const ssh = {
    sshPath: process.execPath,
    expandedConfig: vi
      .fn()
      .mockResolvedValue({ hostname: ['secret.internal'], user: ['private-user'] }),
    preflight: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'CLB_SSH_OK', stderr: '' }),
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'READY', stderr: '' })
  }
  const helper = {
    status: vi
      .fn()
      .mockResolvedValue({ installed: true, version: '1.2.1', detail: '/private/path' })
  }
  const progress = vi.fn()
  const diagnostics = new Diagnostics(
    ssh as unknown as SshClient,
    helper as unknown as HelperManager,
    progress
  )
  return { ssh, helper, diagnostics, progress, profile: DEFAULT_SETTINGS.profiles[0]! }
}

describe('diagnostic snapshots and export', () => {
  it('retains successful checks when the final remote command times out', async () => {
    const { ssh, diagnostics, profile, progress } = setup()
    ssh.run.mockRejectedValue(new Error('Child process timed out after 15000 ms'))
    const report = await diagnostics.run(profile)
    expect(report.complete).toBe(true)
    expect(report.checks).toHaveLength(6)
    expect(report.checks.slice(0, 5).every((check) => check.status === 'ok')).toBe(true)
    expect(report.checks[5]).toMatchObject({ status: 'error', code: 'timeout' })
    expect(
      progress.mock.calls.some(
        ([, value]) => value.activeCheck === 'remote-tools' && value.checks.length === 5
      )
    ).toBe(true)
    expect(diagnostics.latest(profile)).toEqual(report)
    expect(diagnostics.latest({ ...profile, claudePath: 'changed' })).toBeUndefined()
  })
  it('skips dependent remote operations after authentication failure and coalesces repeated runs', async () => {
    const { ssh, helper, diagnostics, profile } = setup()
    ssh.preflight.mockResolvedValue({
      exitCode: 255,
      stdout: '',
      stderr: 'Permission denied (publickey)'
    })
    const first = diagnostics.run(profile)
    expect(diagnostics.run(profile)).toBe(first)
    const report = await first
    expect(report.checks[3]).toMatchObject({ status: 'error', code: 'authentication' })
    expect(report.checks.slice(4).map((check) => check.status)).toEqual(['skipped', 'skipped'])
    expect(ssh.run).not.toHaveBeenCalled()
    expect(helper.status).not.toHaveBeenCalled()
  })
  it('exports only safe fields even when raw output contains arbitrary secrets and network identifiers', async () => {
    const { diagnostics, profile } = setup()
    const report = await diagnostics.run(profile)
    const secrets = [
      'private-user',
      'secret.internal',
      '203.0.113.5',
      '2001:db8::1',
      'C:\\Users\\Alice\\key',
      '/home/alice/private',
      'sk-ant-unlisted-secret',
      'arbitrary-password'
    ]
    report.checks[0]!.detail = secrets.join(' ')
    report.checks[0]!.label = secrets.join(' ')
    const exported = JSON.stringify(redactDiagnosticReport(report))
    for (const secret of secrets) expect(exported).not.toContain(secret.replaceAll('\\', '\\\\'))
    expect(JSON.parse(exported).checks).toHaveLength(6)
    expect(JSON.parse(exported).checks[0]).toMatchObject({
      id: 'app',
      status: 'ok',
      code: 'ok',
      detail: 'Check passed.'
    })
  })
})
