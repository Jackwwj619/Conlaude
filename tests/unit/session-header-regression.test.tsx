import { useAppStore } from '../../src/renderer/src/store'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { useWorkspacePreferences } from '../../src/renderer/src/workspace-preferences'
import { SessionHeader } from '../../src/renderer/src/components/SessionHeader'
import { sessionActivity } from '../../src/renderer/src/session-presentation'
const profile = DEFAULT_SETTINGS.profiles[0]!
const target = { profileId: profile.id, sessionName: 'claude-review' }
afterEach(cleanup)
it('shows both chat and tmux names, exposes reconnect and uses the sidebar activity status', () => {
  useAppStore.setState({ settings: structuredClone(DEFAULT_SETTINGS), timelines: {} })
  useWorkspacePreferences
    .getState()
    .updateSession(profile, target.sessionName, { title: 'Review chat' })
  const status = {
    ...target,
    state: 'attached' as const,
    readOnly: false,
    generating: true,
    promptState: 'ready' as const,
    attempt: 0,
    changedAt: Date.now()
  }
  const reconnect = vi.fn()
  const { container } = render(
    <SessionHeader
      profile={profile}
      target={target}
      status={status}
      onReconnect={reconnect}
      onDisconnect={vi.fn()}
      onObserve={vi.fn()}
      onTakeover={vi.fn()}
      onTerminate={vi.fn()}
      onRenameRemote={vi.fn()}
      onToggleReadingWidth={vi.fn()}
      readingWidthLabel="Width"
    />
  )
  expect(screen.getByRole('heading', { name: 'Review chat' })).toBeVisible()
  expect(screen.getByText(`tmux: ${target.sessionName}`)).toBeVisible()
  const activity = sessionActivity(status)
  expect(activity).toBe('composer.generatingStatus')
  expect(container.querySelector('.connection-label')).toHaveAttribute('data-spinning', 'true')
  fireEvent.click(container.querySelector('.session-menu summary')!)
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }))
  expect(reconnect).toHaveBeenCalledOnce()
})
