import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import {
  readWorkspacePreferences,
  useWorkspacePreferences
} from '../../src/renderer/src/workspace-preferences'
import { sessionActivity } from '../../src/renderer/src/session-presentation'

const profile = DEFAULT_SETTINGS.profiles[0]!
const target = { profileId: profile.id, sessionName: 'claude-review' }

describe('workspace recovery and status semantics', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspacePreferences.setState({ projects: {}, lastTarget: undefined, collapsed: false })
  })

  it('persists local titles and pins and restores only matching connection identities', () => {
    const store = useWorkspacePreferences.getState()
    store.remember(profile, target.sessionName, '/srv/api-service')
    store.updateSession(profile, target.sessionName, { title: '检查回测结果', pinned: true })
    store.setCollapsed(true)
    const saved = readWorkspacePreferences()
    expect(saved.lastTarget).toEqual(target)
    expect(saved.projects.mas!.sessions[target.sessionName]).toMatchObject({
      title: '检查回测结果',
      cwd: '/srv/api-service',
      pinned: true
    })
    expect(saved.collapsed).toBe(true)
    store.reconcile([{ ...profile, label: 'New display name' }])
    expect(useWorkspacePreferences.getState().lastTarget).toEqual(target)
    store.reconcile([{ ...profile, sshHost: 'other-server' }])
    expect(useWorkspacePreferences.getState().lastTarget).toBeUndefined()
    expect(useWorkspacePreferences.getState().projects.mas!.sessions).toEqual({})
  })

  it('keeps same-name sessions isolated across servers and forgets removed sessions', () => {
    const store = useWorkspacePreferences.getState()
    store.remember(profile, target.sessionName)
    store.updateSession(profile, target.sessionName, { title: 'MAS' })
    const other = { ...profile, id: 'exp', sshHost: 'exp' }
    store.remember(other, target.sessionName)
    store.updateSession(other, target.sessionName, { title: 'EXP' })
    store.forget({ ...target, profileId: 'exp' })
    expect(
      useWorkspacePreferences.getState().projects.mas!.sessions[target.sessionName]!.title
    ).toBe('MAS')
    expect(readWorkspacePreferences().lastTarget).toBeUndefined()
  })

  it('recovers from corrupt or unavailable local storage', () => {
    localStorage.setItem('clb:workspace:v1', '{invalid')
    expect(readWorkspacePreferences()).toEqual({ projects: {}, collapsed: false })
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Full')
    })
    expect(() =>
      useWorkspacePreferences.getState().remember(profile, target.sessionName)
    ).not.toThrow()
    expect(useWorkspacePreferences.getState().lastTarget).toEqual(target)
    failure.mockRestore()
  })

  it('prioritizes actionable connection and confirmation states over old replies', () => {
    const status = {
      ...target,
      state: 'attached' as const,
      readOnly: false,
      attempt: 0,
      changedAt: 1,
      promptState: 'ready' as const
    }
    const events = [{ id: 'reply', kind: 'assistant' as const, text: 'Done', isFinal: true }]
    expect(sessionActivity(status, events)).toBe('work.reply')
    expect(sessionActivity({ ...status, promptState: 'confirmation' }, events)).toBe(
      'work.confirmation'
    )
    expect(sessionActivity({ ...status, readOnly: true }, events)).toBe('work.readOnly')
    expect(sessionActivity({ ...status, state: 'reconnecting' }, events)).toBe(
      'status.reconnecting'
    )
    expect(sessionActivity(status, [{ id: 'local-prompt', kind: 'user', text: 'Next' }])).toBe(
      'work.recordPending'
    )
  })
})
