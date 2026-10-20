import { describe, expect, it } from 'vitest'
import { SessionNotifications } from '../../src/main/session-notifications'
import type { SessionStatus } from '../../src/shared/contracts'

const base: SessionStatus = {
  profileId: 'exp',
  sessionName: 'test',
  state: 'attached',
  readOnly: false,
  attempt: 0,
  changedAt: 1,
  promptState: 'ready',
  generating: false
}
describe('live session notifications', () => {
  it('does not notify on initial attach, deduplicates transitions, and isolates sessions', () => {
    const notices = new SessionNotifications()
    expect(notices.observe(base)).toBeUndefined()
    expect(notices.observe({ ...base, generating: true })).toBeUndefined()
    expect(notices.observe({ ...base, sessionName: 'other' })).toBeUndefined()
    expect(notices.observe(base)).toBe('finished')
    expect(notices.observe(base)).toBeUndefined()
    expect(notices.observe({ ...base, promptState: 'confirmation' })).toBe('confirmation')
    expect(notices.observe({ ...base, promptState: 'confirmation' })).toBeUndefined()
    expect(notices.observe({ ...base, state: 'failed' })).toBe('failed')
    expect(notices.observe({ ...base, state: 'failed' })).toBeUndefined()
  })
  it('does not report completion after reconnect or for read-only observation', () => {
    const notices = new SessionNotifications()
    notices.observe({ ...base, generating: true })
    notices.observe({ ...base, state: 'reconnecting' })
    expect(notices.observe(base)).toBeUndefined()
    notices.observe({ ...base, readOnly: true, generating: true })
    expect(notices.observe({ ...base, readOnly: true })).toBeUndefined()
    expect(
      notices.observe({ ...base, readOnly: true, promptState: 'confirmation' })
    ).toBeUndefined()
  })
})
