import { describe, expect, it } from 'vitest'
import {
  helperCommand,
  parseSshConfig,
  shellQuote,
  scpArgsFor,
  executableCheck,
  sshArgsFor,
  sshTarget
} from '../../src/main/ssh-client'
import type { Profile } from '../../src/shared/contracts'

describe('remote command argument encoding', () => {
  it('quotes apostrophes using POSIX-safe quoting', () => {
    expect(shellQuote("a'b")).toBe("'a'\"'\"'b'")
  })

  it('keeps helper entrypoint fixed and quotes every argument', () => {
    expect(helperCommand(['inspect-session', '--name', 'claude-mas'])).toBe(
      "python3 ~/.local/share/claude-local-bridge/bridge_agent.py 'inspect-session' '--name' 'claude-mas'"
    )
  })

  it('rejects NUL before command construction', () => {
    expect(() => shellQuote('bad\0value')).toThrow()
  })
})

const baseProfile: Profile = {
  id: 'p',
  label: 'P',
  host: '10.0.0.5',
  port: 22,
  authMode: 'key',
  defaultSession: 'claude-p',
  defaultCwd: '/root',
  claudePath: '/usr/bin/claude'
}

describe('sshArgsFor', () => {
  it('builds user@host when user is set and port is default', () => {
    expect(sshArgsFor({ ...baseProfile, user: 'ubuntu' })).toEqual(['ubuntu@10.0.0.5'])
  })

  it('adds -p when port is not 22', () => {
    expect(sshArgsFor({ ...baseProfile, user: 'ubuntu', port: 2222 })).toEqual([
      '-p',
      '2222',
      'ubuntu@10.0.0.5'
    ])
  })

  it('adds -i for key auth when privateKeyPath is set', () => {
    expect(
      sshArgsFor({ ...baseProfile, user: 'u', privateKeyPath: '/home/u/.ssh/id_ed25519' })
    ).toEqual(['-i', '/home/u/.ssh/id_ed25519', 'u@10.0.0.5'])
  })

  it('adds ForwardAgent for agent auth', () => {
    expect(sshArgsFor({ ...baseProfile, user: 'u', authMode: 'agent' })).toEqual([
      '-o',
      'ForwardAgent=yes',
      'u@10.0.0.5'
    ])
  })

  it('adds -J for proxyJump', () => {
    expect(sshArgsFor({ ...baseProfile, user: 'u', proxyJump: 'bastion' })).toEqual([
      '-J',
      'bastion',
      'u@10.0.0.5'
    ])
  })

  it('lets a configured Host supply all connection options', () => {
    expect(
      sshArgsFor({
        ...baseProfile,
        sshHost: 'mas',
        user: 'ignored-user',
        port: 2222,
        authMode: 'agent',
        privateKeyPath: 'C:\\Users\\you\\.ssh\\id_ed25519',
        proxyJump: 'ignored-bastion'
      })
    ).toEqual(['mas'])
  })

  it('appends the remote command when provided', () => {
    expect(sshArgsFor({ ...baseProfile, user: 'u' }, 'echo hi')).toEqual(['u@10.0.0.5', 'echo hi'])
  })

  it('sshTarget uses alias when present', () => {
    expect(sshTarget({ ...baseProfile, sshHost: 'mas' })).toBe('mas')
  })

  it('sshTarget builds user@host without alias', () => {
    expect(sshTarget({ ...baseProfile, user: 'ubuntu' })).toBe('ubuntu@10.0.0.5')
  })
})

describe('OpenSSH config parsing', () => {
  it('reads a standard Host block without flattening its connection options', () => {
    expect(
      parseSshConfig(
        [
          'Host mas',
          '  HostName 203.0.113.10',
          '  User ubuntu',
          '  IdentityFile C:\\Users\\you\\.ssh\\id_ed25519',
          '  IdentitiesOnly yes',
          '  Port 22'
        ].join('\n')
      )
    ).toEqual([
      {
        host: 'mas',
        hostName: '203.0.113.10',
        user: 'ubuntu',
        identityFile: 'C:\\Users\\you\\.ssh\\id_ed25519',
        identitiesOnly: true,
        port: 22
      }
    ])
  })
})

describe('file transfer connection settings', () => {
  it('preserves the manual port, user, identity and jump host for scp', () => {
    expect(
      scpArgsFor(
        {
          ...baseProfile,
          user: 'alice',
          port: 2202,
          privateKeyPath: 'C:/keys/private key',
          proxyJump: 'jump'
        },
        'C:/file.txt',
        '~/file.txt'
      )
    ).toEqual([
      '-q',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-P',
      '2202',
      '-i',
      'C:/keys/private key',
      '-J',
      'jump',
      '--',
      'C:/file.txt',
      'alice@10.0.0.5:~/file.txt'
    ])
  })

  it('uses only the SSH alias when configured', () => {
    const args = scpArgsFor(
      { ...baseProfile, sshHost: 'exp', port: 2202, user: 'ignored' },
      'local',
      '~/remote'
    )
    expect(args).not.toContain('-P')
    expect(args.at(-1)).toBe('exp:~/remote')
  })

  it('brackets IPv6 addresses in remote file destinations', () => {
    expect(
      scpArgsFor({ ...baseProfile, host: '2001:db8::1', user: 'alice' }, 'local', '/remote').at(-1)
    ).toBe('alice@[2001:db8::1]:/remote')
  })

  it('checks command aliases through Bash without exposing their definitions', () => {
    expect(executableCheck('cc')).toBe(
      `bash -lic ${shellQuote("type -t -- 'cc' >/dev/null")} 2>/dev/null`
    )
    expect(executableCheck('~/.local/bin/claude')).toBe(`test -x "$HOME"/'.local/bin/claude'`)
  })
})
