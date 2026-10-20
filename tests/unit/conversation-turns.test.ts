import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore, targetKey } from '../../src/renderer/src/store'
import {
  formatTurnDuration,
  presentTurn,
  splitConversationTurns
} from '../../src/renderer/src/conversation-turns'
import { normalizeTranscriptEvent } from '../../src/shared/transcript'
import type { TimelineEvent } from '../../src/shared/contracts'

const target = { profileId: 'mas', sessionName: 'timing' }
const key = targetKey(target)
const current = () =>
  splitConversationTurns(useAppStore.getState().timelines[key] ?? []).turns.at(-1)!
const add = (event: TimelineEvent) => useAppStore.getState().addTimelineEvent(target, event)
const send = (id = 'local-request') =>
  add({ id, kind: 'user', text: 'hello', turnStartedAt: Date.now(), localDelivery: 'sending' })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
  useAppStore.setState({ timelines: {}, statuses: {}, delivery: {}, settings: undefined })
})
afterEach(() => vi.useRealTimers())

describe('request timing and outcomes', () => {
  it('waits through intermediate text and freezes at final receipt rather than the later terminal poll', () => {
    send()
    const status = {
      ...target,
      state: 'attached' as const,
      readOnly: false,
      attempt: 0,
      changedAt: Date.now(),
      promptState: 'ready' as const
    }
    useAppStore.getState().setStatus({ ...status, generating: true })
    add({ id: 'first-text', kind: 'assistant', isFinal: true, text: 'I will inspect the file.' })
    expect(useAppStore.getState().delivery[key]).toBe('generating')
    add({ id: 'next-tool', kind: 'tool-use', toolName: 'Read' })
    expect(presentTurn(current()).completed).toBe(false)
    vi.advanceTimersByTime(88000)
    add({ id: 'final-after-work', kind: 'assistant', isFinal: true, text: 'Inspection complete.' })
    expect(presentTurn(current(), true).endedAt).toBeUndefined()
    const received = Date.now()
    vi.advanceTimersByTime(6000)
    useAppStore.getState().setStatus({ ...status, generating: false })
    expect(useAppStore.getState().delivery[key]).toBe('finished')
    expect(presentTurn(current()).endedAt).toBe(received)
  })
  it('includes send latency and retries, uses local receipt time despite remote clock skew, and does not grow on duplicate replay', () => {
    send()
    vi.advanceTimersByTime(8000)
    add({ id: 'remote-prompt', kind: 'user', text: 'hello', timestamp: '2030-01-01T00:00:00Z' })
    useAppStore.getState().updatePromptDelivery(target, 'local-request', 'sent')
    expect(current().prompt).toMatchObject({
      renderId: 'local-request',
      turnStartedAt: Date.parse('2026-10-05T00:00:00Z'),
      localDelivery: 'sent'
    })
    add({ id: 'retry', kind: 'error', responseError: { code: '503', retrying: true } })
    expect(presentTurn(current())).toMatchObject({
      completed: false,
      failed: false,
      endedAt: undefined
    })
    vi.advanceTimersByTime(80000)
    const reply: TimelineEvent = {
      id: 'final',
      kind: 'assistant',
      isFinal: true,
      text: 'done',
      timestamp: '2030-01-01T00:03:00Z'
    }
    add(reply)
    const done = presentTurn(current())
    expect(done.endedAt! - done.startedAt!).toBe(88000)
    expect(formatTurnDuration(done.endedAt! - done.startedAt!)).toBe('1m 28s')
    expect(useAppStore.getState().delivery[key]).toBe('finished')
    vi.advanceTimersByTime(10000)
    add(reply)
    expect(presentTurn(current()).endedAt).toBe(done.endedAt)
  })

  it('keeps repeated identical prompts distinct and preserves the pending timer during remote echo reconciliation', () => {
    add({ id: 'old-prompt', kind: 'user', text: 'hello' })
    add({ id: 'old-final', kind: 'assistant', text: 'old' })
    send('local-new')
    expect(splitConversationTurns(useAppStore.getState().timelines[key]!).turns).toHaveLength(2)
    add({ id: 'new-prompt', kind: 'user', text: 'hello' })
    expect(current().prompt.renderId).toBe('local-new')
    expect(presentTurn(current()).completed).toBe(false)
  })

  it('does not end a tracked request just because the spinner disappears and acknowledges an explicit stop separately', () => {
    send()
    const status = {
      ...target,
      state: 'attached' as const,
      readOnly: false,
      attempt: 0,
      changedAt: Date.now(),
      promptState: 'ready' as const
    }
    useAppStore.getState().setStatus({ ...status, generating: true })
    useAppStore.getState().setStatus({ ...status, generating: false })
    expect(useAppStore.getState().delivery[key]).toBe('sent')
    expect(presentTurn(current()).completed).toBe(false)
    useAppStore.getState().requestTurnStop(target, true)
    vi.advanceTimersByTime(1200)
    useAppStore.getState().setStatus({ ...status, generating: false })
    expect(presentTurn(current())).toMatchObject({
      stopped: true,
      completed: false,
      endedAt: Date.now()
    })
  })

  it('keeps failures separate from tool output and other sessions, and allows a later recovered answer', () => {
    send()
    add({ id: 'tool', kind: 'tool-result', isError: true, toolResult: 'command failed' })
    expect(presentTurn(current()).failed).toBe(false)
    useAppStore
      .getState()
      .addTimelineEvent(
        { ...target, sessionName: 'other' },
        { id: 'other', kind: 'assistant', text: 'done' }
      )
    expect(presentTurn(current()).completed).toBe(false)
    add({
      id: 'failure',
      kind: 'error',
      text: 'API Error: 503',
      responseError: { code: '503', retrying: false }
    })
    expect(useAppStore.getState().delivery[key]).toBe('response-failed')
    add({ id: 'recovered', kind: 'assistant', text: 'Recovered' })
    expect(presentTurn(current())).toMatchObject({
      completed: true,
      failed: false,
      problem: undefined
    })
  })

  it('uses remote timestamps only for history and does not invent missing timing', () => {
    const prompt: TimelineEvent = {
      id: 'p',
      kind: 'user',
      text: 'hi',
      timestamp: '2026-10-05T00:00:00Z'
    }
    const turn = {
      id: 'p',
      prompt,
      events: [
        { id: 'f', kind: 'assistant' as const, text: 'hi', timestamp: '2026-10-05T00:01:28Z' }
      ]
    }
    const done = presentTurn(turn)
    expect(done.endedAt! - done.startedAt!).toBe(88000)
    expect(
      presentTurn({ ...turn, prompt: { ...prompt, timestamp: undefined } }).startedAt
    ).toBeUndefined()
  })
})

describe('explicit service errors', () => {
  it('retains the HTTP code and details from Claude API error messages', () => {
    const [event] = normalizeTranscriptEvent({
      type: 'assistant',
      uuid: 'api',
      isApiErrorMessage: true,
      error: 'unknown',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'API Error: 503 service unavailable' }]
      }
    })
    expect(event).toMatchObject({
      kind: 'error',
      isError: true,
      responseError: { code: '503', retrying: false }
    })
  })
  it('surfaces retry records and nested authentication errors', () => {
    expect(
      normalizeTranscriptEvent({
        type: 'system',
        subtype: 'api_error',
        error: { status: 429, message: 'rate limited' },
        retryAttempt: 2,
        retryInMs: 4000
      })[0]
    ).toMatchObject({
      kind: 'error',
      responseError: { code: '429', retrying: true, retryAfterMs: 4000, attempt: 2 }
    })
    expect(
      normalizeTranscriptEvent({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid credentials' }
      })[0]
    ).toMatchObject({
      kind: 'error',
      text: 'Invalid credentials',
      responseError: { code: 'authentication_error' }
    })
  })
  it('does not treat mentions of status codes or failing tools as service outages', () => {
    expect(
      normalizeTranscriptEvent({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'HTTP 503 means unavailable; the service is healthy now.' }
          ]
        }
      })[0]?.kind
    ).toBe('assistant')
    expect(
      normalizeTranscriptEvent({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', is_error: true, content: 'HTTP 503 in a test' }]
        }
      })[0]?.kind
    ).toBe('tool-result')
  })
})
