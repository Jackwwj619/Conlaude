import type { Profile } from './contracts'

/** Presentation and launch defaults do not change an existing SSH connection. */
export function connectionIdentity(profile: Profile): string {
  return JSON.stringify(
    profile.sshHost
      ? { sshHost: profile.sshHost }
      : {
          host: profile.host,
          port: profile.port,
          user: profile.user,
          authMode: profile.authMode,
          privateKeyPath: profile.privateKeyPath,
          proxyJump: profile.proxyJump
        }
  )
}
