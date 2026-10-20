import type { SessionStatus } from '../shared/contracts'

export type SessionNotice = 'confirmation' | 'finished' | 'failed'

/** Tracks live status transitions, never replayed transcript text. */
export class SessionNotifications {
  private readonly previous = new Map<string, SessionStatus>()
  observe(status: SessionStatus): SessionNotice | undefined {
    const key = `${status.profileId}:${status.sessionName}`
    const previous = this.previous.get(key)
    this.previous.set(key, { ...status })
    if (status.state === 'detached') this.previous.delete(key)
    if (this.previous.size > 200) this.previous.delete(this.previous.keys().next().value!)
    if (status.state === 'failed' && previous?.state !== 'failed') return 'failed'
    if (status.readOnly || status.state !== 'attached') return
    if (status.promptState === 'confirmation' && previous?.promptState !== 'confirmation')
      return 'confirmation'
    if (
      previous?.state === 'attached' &&
      previous.generating &&
      status.generating === false &&
      status.promptState === 'ready'
    )
      return 'finished'
  }
}
