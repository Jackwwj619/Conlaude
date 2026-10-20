import { describe, expect, it } from 'vitest'
import {
  groupSessionDirectories,
  matchesActivity
} from '../../src/renderer/src/workspace-navigation'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { connectionIdentity } from '../../src/shared/profile-identity'
import type { SessionStatus } from '../../src/shared/contracts'

const profile = { ...DEFAULT_SETTINGS.profiles[0]!, defaultCwd: '/srv/default' }
const session = (name: string, currentPath?: string) => ({
  name,
  currentPath,
  windows: 1,
  attachedClients: 0
})
describe('project navigation', () => {
  it('groups real directories and preserves the old default-folder fold key', () => {
    const groups = groupSessionDirectories(profile, [
      session('a', '/srv/api/'),
      session('b', '/srv/web'),
      session('c', '/srv/api'),
      session('d')
    ])
    expect(groups.map((group) => group.path)).toEqual(['/srv/default', '/srv/api', '/srv/web'])
    expect(groups[1]!.sessions.map((item) => item.name)).toEqual(['a', 'c'])
    expect(groups[0]!.foldKey).toBe(connectionIdentity(profile))
  })
  it('distinguishes equal folder names and preserves remote case sensitivity', () => {
    const groups = groupSessionDirectories(profile, [
      session('a', '/work/api'),
      session('b', '/test/api'),
      session('c', '/work/API')
    ])
    expect(new Set(groups.map((group) => group.label))).toEqual(
      new Set(['/test/api', 'API', '/work/api'])
    )
    expect(new Set(groups.map((group) => group.foldKey)).size).toBe(3)
  })
  it('keeps an empty default project and filters only current activity', () => {
    expect(groupSessionDirectories(profile, [])[0]?.path).toBe('/srv/default')
    const status: SessionStatus = {
      profileId: 'mas',
      sessionName: 'a',
      state: 'attached',
      readOnly: false,
      attempt: 0,
      changedAt: 0,
      generating: true,
      promptState: 'ready'
    }
    expect(matchesActivity(status, 'running')).toBe(true)
    expect(matchesActivity({ ...status, state: 'detached' }, 'running')).toBe(false)
    expect(matchesActivity({ ...status, promptState: 'confirmation' }, 'attention')).toBe(true)
    expect(matchesActivity({ ...status, state: 'failed' }, 'attention')).toBe(true)
    expect(matchesActivity(undefined, 'attention')).toBe(false)
  })
})
