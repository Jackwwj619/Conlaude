import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionTarget } from '../../src/shared/contracts'
import { targetKey, useAppStore } from '../../src/renderer/src/store'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

const target: SessionTarget = { profileId: 'mas', sessionName: 'claude-test' }

describe('session-local renderer state', () => {
  it.each(['single', 'batch'])('reconciles a late receipt after send failure (%s)', (mode) => {
    const store = useAppStore.getState()
    const key = targetKey(target)
    store.addTimelineEvent(target, {
      id: 'local-late',
      kind: 'user',
      text: 'late receipt',
      turnStartedAt: Date.now(),
      localDelivery: 'sending'
    })
    store.updatePromptDelivery(target, 'local-late', 'failed', 'unconfirmed')
    store.setDelivery(target, 'failed')
    store.setComposerFeedback(target, {
      kind: 'error',
      message: 'unconfirmed',
      promptId: 'local-late'
    })
    const event = { id: 'remote-late', kind: 'user' as const, text: 'late receipt' }
    if (mode === 'batch') store.addTimelineEvents([{ target, event }])
    else store.addTimelineEvent(target, event)
    expect(useAppStore.getState().timelines[key]).toHaveLength(1)
    expect(useAppStore.getState().timelines[key]![0]).toMatchObject({
      id: 'remote-late',
      renderId: 'local-late',
      localDelivery: 'sent'
    })
    expect(useAppStore.getState().composerFeedback[key]?.message).toBe('')
    expect(useAppStore.getState().delivery[key]).toBe('sent')
    store.updatePromptDelivery(target, 'local-late', 'failed', 'late transport error')
    store.setDelivery(target, 'failed')
    expect(useAppStore.getState().delivery[key]).toBe('sent')
    expect(useAppStore.getState().timelines[key]![0]?.sendError).toBeUndefined()
  })

  it('does not clear a send warning for output or a receipt in another session', () => {
    const store = useAppStore.getState()
    const feedback = { kind: 'error' as const, message: 'unconfirmed', promptId: 'local-failed' }
    store.setComposerFeedback(target, feedback)
    store.addTimelineEvent(target, { id: 'output', kind: 'assistant', text: 'unrelated' })
    store.addTimelineEvent(
      { ...target, sessionName: 'other' },
      { id: 'receipt', kind: 'user', text: 'other' }
    )
    expect(useAppStore.getState().composerFeedback[targetKey(target)]).toEqual(feedback)
  })
  it('merges Claude image extraction with the pending local prompt', () => {
    useAppStore.setState({ timelines: {} })
    const store = useAppStore.getState()
    store.addTimelineEvent(target, {
      id: 'local-image',
      kind: 'user',
      text: 'Describe this\n/home/test/.local/share/claude-local-bridge/uploads/demo/123-test.png',
      localDelivery: 'sent'
    })
    store.addTimelineEvent(target, {
      id: 'remote-image',
      kind: 'user',
      text: '[Image #1]Describe this'
    })
    expect(useAppStore.getState().timelines[targetKey(target)]).toHaveLength(1)
    expect(useAppStore.getState().timelines[targetKey(target)]![0]!.id).toBe('remote-image')
  })
  it('replaces an abandoned conversation branch only when a new user message names an earlier parent', () => {
    useAppStore.setState({ timelines: {}, settings: undefined })
    const store = useAppStore.getState()
    store.addTimelineEvents([
      { target, event: { id: 'u1', messageId: 'u1', kind: 'user', text: 'first' } },
      {
        target,
        event: { id: 'a1', messageId: 'a1', parentId: 'u1', kind: 'assistant', text: 'keep' }
      },
      {
        target,
        event: {
          id: 'u2',
          messageId: 'u2',
          parentId: 'a1',
          kind: 'user',
          text: 'abandoned question'
        }
      },
      {
        target,
        event: {
          id: 'a2',
          messageId: 'a2',
          parentId: 'u2',
          kind: 'assistant',
          text: 'abandoned answer'
        }
      },
      {
        target,
        event: {
          id: 'u3',
          messageId: 'u3',
          parentId: 'a1',
          kind: 'user',
          text: 'replacement question'
        }
      }
    ])
    expect(useAppStore.getState().timelines[targetKey(target)]?.map((event) => event.id)).toEqual([
      'u1',
      'a1',
      'u3'
    ])
  })
  it('keeps live delivery status separate by session without treating history as generation', () => {
    const store = useAppStore.getState()
    const other = { ...target, sessionName: 'other' }
    store.setDelivery(target, 'sending')
    store.setDelivery(target, 'sent')
    store.addTimelineEvent(other, { id: 'old', kind: 'assistant', isFinal: true, text: 'history' })
    expect(useAppStore.getState().delivery[targetKey(other)]).toBeUndefined()
    store.setStatus({
      ...target,
      state: 'attached',
      readOnly: false,
      promptState: 'ready',
      generating: true,
      attempt: 0,
      changedAt: Date.now()
    })
    store.setDelivery(target, 'sent')
    expect(useAppStore.getState().delivery[targetKey(target)]).toBe('generating')
    store.setStatus({
      ...target,
      state: 'attached',
      readOnly: false,
      promptState: 'ready',
      generating: false,
      attempt: 0,
      changedAt: Date.now()
    })
    expect(useAppStore.getState().delivery[targetKey(target)]).toBe('finished')
    store.clearSessionData(target)
    expect(useAppStore.getState().delivery[targetKey(target)]).toBeUndefined()
  })
  it('batches history without duplicating echoes or mixing targets', () => {
    useAppStore.setState({ timelines: {}, settings: undefined, claudeModes: {} })
    const other = { ...target, sessionName: 'other' }
    useAppStore.getState().addTimelineEvents([
      { target, event: { id: 'local-echo', kind: 'user', text: 'hello' } },
      { target: other, event: { id: 'reply', kind: 'assistant', text: 'other' } },
      { target, event: { id: 'remote', kind: 'user', text: 'hello' } },
      { target, event: { id: 'reply', kind: 'assistant', text: 'first' } },
      { target, event: { id: 'reply', kind: 'assistant', text: 'updated', permissionMode: 'plan' } }
    ])
    expect(useAppStore.getState().timelines[targetKey(target)]).toMatchObject([
      { id: 'remote', renderId: 'local-echo' },
      { id: 'reply', text: 'updated' }
    ])
    expect(useAppStore.getState().timelines[targetKey(other)]?.[0]?.text).toBe('other')
    expect(useAppStore.getState().claudeModes[targetKey(target)]).toBe('plan')
  })
  it('replays a large history without mutating published state or losing updates within a batch', () => {
    const store = useAppStore.getState()
    store.addTimelineEvent(target, { id: 'seed', kind: 'user', text: 'seed' })
    const previous = useAppStore.getState().timelines[targetKey(target)]!
    const entries = Array.from({ length: 20000 }, (_, index) => ({
      target,
      event: { id: `history-${index}`, kind: 'assistant' as const, text: `Reply ${index}` }
    }))
    const started = performance.now()
    store.addTimelineEvents([
      ...entries,
      { target, event: { id: 'history-19', kind: 'assistant', text: 'updated' } },
      {
        target,
        event: { id: 'local-pending', kind: 'user', text: 'new request', turnStartedAt: 1 }
      },
      { target, event: { id: 'remote-pending', kind: 'user', text: 'new request' } },
      {
        target,
        event: { id: 'remote-pending', kind: 'user', text: 'new request', permissionMode: 'plan' }
      }
    ])
    const duration = performance.now() - started
    const current = useAppStore.getState().timelines[targetKey(target)]!
    expect(previous).toHaveLength(1)
    expect(current).toHaveLength(20002)
    expect(current[0]).toBe(previous[0])
    expect(current[20]?.text).toBe('updated')
    expect(current.at(-1)).toMatchObject({
      id: 'remote-pending',
      renderId: 'local-pending',
      turnStartedAt: 1
    })
    expect(useAppStore.getState().claudeModes[targetKey(target)]).toBe('plan')
    // A broad regression budget: the old per-row scan/copy path takes seconds.
    expect(duration).toBeLessThan(1000)
  })
  beforeEach(() => {
    useAppStore.setState({
      settings: undefined,
      selected: undefined,
      selectedByProfile: {},
      sessions: [],
      sessionsByProfile: {},
      composerBusy: {},
      composerFeedback: {},
      delivery: {},
      statuses: {},
      claudeModes: {},
      timelines: {},
      terminalBuffers: {}
    })
  })

  it('clears stale timeline and terminal output before a same-name session is reused', () => {
    const key = targetKey(target)
    useAppStore.setState({
      claudeModes: { [key]: 'plan' },
      timelines: {
        [key]: [{ id: 'old', kind: 'assistant', text: 'old session reply' }]
      },
      terminalBuffers: { [key]: 'old terminal output' }
    })

    useAppStore.getState().clearSessionData(target)

    expect(useAppStore.getState().timelines[key]).toBeUndefined()
    expect(useAppStore.getState().terminalBuffers[key]).toBeUndefined()
    expect(useAppStore.getState().claudeModes[key]).toBeUndefined()
  })

  it('keeps the latest transcript permission mode per session', () => {
    const key = targetKey(target)
    useAppStore.getState().setClaudeMode(target, 'acceptEdits')
    useAppStore.getState().setClaudeMode(target, 'plan')

    expect(useAppStore.getState().claudeModes[key]).toBe('plan')
  })

  it('restores each server selection without mixing same-name session history', () => {
    const other = { ...DEFAULT_SETTINGS.profiles[0]!, id: 'exp', sshHost: 'exp' }
    const settings = { ...DEFAULT_SETTINGS, profiles: [...DEFAULT_SETTINGS.profiles, other] }
    const store = useAppStore.getState()
    store.setSettings(settings)
    store.select(target)
    store.addTimelineEvent(target, { id: 'first', kind: 'assistant', text: 'MAS history' })
    store.setSettings({ ...settings, currentProfileId: 'exp' })
    store.select({ ...target, profileId: 'exp' })
    store.addTimelineEvent(
      { ...target, profileId: 'exp' },
      { id: 'second', kind: 'assistant', text: 'EXP history' }
    )
    store.setSettings(settings)
    expect(useAppStore.getState().selected).toEqual(target)
    expect(useAppStore.getState().timelines[targetKey(target)]?.[0]?.text).toBe('MAS history')
    expect(useAppStore.getState().timelines[`exp:${target.sessionName}`]?.[0]?.text).toBe(
      'EXP history'
    )
  })

  it('clears stale endpoint data when a detached server configuration changes', () => {
    const store = useAppStore.getState()
    store.setSettings(DEFAULT_SETTINGS)
    store.select(target)
    store.addTimelineEvent(target, { id: 'old', kind: 'assistant', text: 'Old server' })
    store.setSettings({
      ...DEFAULT_SETTINGS,
      profiles: [{ ...DEFAULT_SETTINGS.profiles[0]!, sshHost: 'new-host' }]
    })
    expect(useAppStore.getState().timelines[targetKey(target)]).toBeUndefined()
    expect(useAppStore.getState().selected?.sessionName).toBe(
      DEFAULT_SETTINGS.profiles[0]!.defaultSession
    )
  })

  it('drops removed server data and restores the remaining server selection', () => {
    const other = { ...DEFAULT_SETTINGS.profiles[0]!, id: 'exp', sshHost: 'exp' }
    const store = useAppStore.getState()
    store.setSettings({ ...DEFAULT_SETTINGS, profiles: [...DEFAULT_SETTINGS.profiles, other] })
    store.select({ ...target, profileId: 'exp' })
    store.addTimelineEvent(
      { ...target, profileId: 'exp' },
      { id: 'keep', kind: 'assistant', text: 'EXP' }
    )
    store.setSessions([{ name: 'claude-test', windows: 1, attachedClients: 0 }], 'mas')
    store.select(target)
    store.addTimelineEvent(target, { id: 'drop', kind: 'assistant', text: 'MAS' })
    store.appendTerminalData(target, 'old terminal')
    store.setSettings({ ...DEFAULT_SETTINGS, profiles: [other], currentProfileId: other.id })
    const state = useAppStore.getState()
    expect(state.selected).toEqual({ ...target, profileId: 'exp' })
    expect(state.timelines['exp:claude-test']?.[0]?.text).toBe('EXP')
    expect(state.timelines[targetKey(target)]).toBeUndefined()
    expect(state.terminalBuffers[targetKey(target)]).toBeUndefined()
    expect(state.sessionsByProfile.mas).toBeUndefined()
    expect(state.selectedByProfile.mas).toBeUndefined()
  })

  it('clears the current workspace when the last server is deleted', () => {
    const store = useAppStore.getState()
    store.setSettings(DEFAULT_SETTINGS)
    store.select(target)
    store.setSessions([{ name: target.sessionName, windows: 1, attachedClients: 0 }])
    store.setSettings({ ...DEFAULT_SETTINGS, profiles: [], currentProfileId: '' })
    expect(useAppStore.getState()).toMatchObject({
      selected: undefined,
      selectedByProfile: {},
      sessions: [],
      sessionsByProfile: {},
      directControl: false
    })
  })

  it('replaces an optimistic user echo with its normalized transcript event', () => {
    const key = targetKey(target)
    const local = {
      id: 'local-31de0a5c-03ca-4b89-9825-4113f1917d14',
      kind: 'user' as const,
      text: 'first line\r\nsecond line\n',
      timestamp: '2026-09-07T08:00:00.000Z'
    }
    const transcript = {
      id: 'transcript-user-1',
      kind: 'user' as const,
      text: 'first line\nsecond line',
      timestamp: '2026-09-07T08:00:12.000Z',
      rawType: 'user'
    }

    useAppStore.getState().addTimelineEvent(target, local)
    useAppStore.getState().addTimelineEvent(target, transcript)

    expect(useAppStore.getState().timelines[key]).toEqual([
      { ...transcript, renderId: local.id, receivedAt: expect.any(Number), localDelivery: 'sent' }
    ])
  })

  it('does not add a late optimistic echo when the transcript event arrived first', () => {
    const key = targetKey(target)
    const transcript = {
      id: 'transcript-user-2',
      kind: 'user' as const,
      text: 'hi',
      rawType: 'user'
    }
    const local = {
      id: 'local-1a53b185-f958-43fb-825a-740f280cb866',
      kind: 'user' as const,
      text: 'hi'
    }

    useAppStore.getState().addTimelineEvent(target, transcript)
    useAppStore.getState().addTimelineEvent(target, local)

    expect(useAppStore.getState().timelines[key]).toEqual([
      { ...transcript, receivedAt: expect.any(Number) }
    ])
  })
})
