import { describe, expect, it } from 'vitest'
import { normalizeTranscriptEvent } from '../../src/shared/transcript'

describe('Claude transcript adapter', () => {
  it('does not render image source bookkeeping as a separate user turn', () => {
    expect(
      normalizeTranscriptEvent({
        type: 'user',
        message: { role: 'user', content: '[Image: source: /home/test/image.png]' }
      })
    ).toEqual([])
  })
  it('hides native command bookkeeping and ANSI output from chat history', () => {
    const records = [
      '<local-command-caveat>Caveat: local commands</local-command-caveat>',
      '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>',
      '<local-command-stdout>Set model\u001b[2m output\u001b[22m</local-command-stdout>',
      '<local-command-stderr>Command failed</local-command-stderr>'
    ]
    for (const text of records) {
      for (const content of [text, [{ type: 'text', text }]])
        expect(normalizeTranscriptEvent({ type: 'user', message: { content } })).toEqual([])
    }
  })

  it('preserves normal messages discussing native command tags and assistant replies', () => {
    for (const text of ['/model', 'Explain <command-name>/model</command-name>', 'Normal reply'])
      expect(normalizeTranscriptEvent({ type: 'user', message: { content: text } })[0]?.text).toBe(
        text
      )
    const text = '<local-command-stdout>Example</local-command-stdout>'
    expect(
      normalizeTranscriptEvent({ type: 'assistant', message: { content: text } })[0]?.text
    ).toBe(text)
  })

  it('preserves reported models on assistant text, thinking and tool-only responses', () => {
    for (const content of [
      [{ type: 'text', text: 'Reply' }],
      [{ type: 'thinking', thinking: 'Thinking' }],
      [{ type: 'tool_use', id: 't', name: 'Read', input: {} }],
      []
    ]) {
      const events = normalizeTranscriptEvent({
        type: 'assistant',
        message: { model: ' claude-sonnet-test ', content }
      })
      expect(events.length).toBeGreaterThan(0)
      expect(events.every((event) => event.model === 'claude-sonnet-test')).toBe(true)
    }
  })

  it('ignores synthetic, malformed, user and error model reports', () => {
    for (const model of [undefined, '', '  ', '<synthetic>', 123]) {
      expect(
        normalizeTranscriptEvent({
          type: 'assistant',
          message: { model, content: 'Reply' }
        })[0]?.model
      ).toBeUndefined()
    }
    for (const raw of [
      { type: 'user', message: { model: 'fake', content: 'Hi' } },
      { type: 'assistant', isApiErrorMessage: true, message: { model: 'fake', content: 'Error' } }
    ])
      expect(normalizeTranscriptEvent(raw)[0]?.model).toBeUndefined()
  })

  it('normalizes a user message', () => {
    const [event] = normalizeTranscriptEvent(
      {
        type: 'user',
        uuid: 'user-1',
        timestamp: '2026-09-06T00:00:00Z',
        message: { role: 'user', content: '检查这个项目' }
      },
      120
    )
    expect(event).toMatchObject({
      id: 'user-1',
      kind: 'user',
      text: '检查这个项目',
      offset: 120
    })
  })

  it('separates assistant text and tool calls', () => {
    const events = normalizeTranscriptEvent({
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '我来检查。' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a' } }
        ]
      }
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ kind: 'assistant', isFinal: false, text: '我来检查。' })
    expect(events[1]).toMatchObject({ kind: 'tool-use', toolName: 'Read' })
  })

  it('marks a text-only assistant response as final and folds thinking into status activity', () => {
    const finalEvents = normalizeTranscriptEvent({
      type: 'assistant',
      uuid: 'assistant-final',
      message: { role: 'assistant', content: [{ type: 'text', text: '已经完成。' }] }
    })
    const thinkingEvents = normalizeTranscriptEvent({
      type: 'assistant',
      uuid: 'assistant-thinking',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '先梳理一下。' }] }
    })

    expect(finalEvents).toMatchObject([{ kind: 'assistant', isFinal: true, text: '已经完成。' }])
    expect(thinkingEvents).toMatchObject([
      { kind: 'status', activityType: 'thinking', text: '先梳理一下。' }
    ])
  })

  it('carries the latest Claude permission mode into transcript events', () => {
    const [event] = normalizeTranscriptEvent({
      type: 'user',
      uuid: 'permission-mode',
      permissionMode: 'plan',
      message: { role: 'user', content: '先列计划' }
    })

    expect(event).toMatchObject({ kind: 'user', text: '先列计划', permissionMode: 'plan' })
  })

  it('silently ignores internal and future metadata event types', () => {
    expect(normalizeTranscriptEvent({ type: 'attachment', payload: 1 })).toEqual([])
    expect(normalizeTranscriptEvent({ type: 'future-event', payload: 1 })).toEqual([])
  })

  it('handles malformed non-object input', () => {
    expect(normalizeTranscriptEvent(null, 44)).toEqual([])
  })
})
