import { describe, expect, it } from 'vitest'
import { pairToolEvents, searchableEvent } from '../../src/renderer/src/conversation-model'
import { normalizeTranscriptEvent } from '../../src/shared/transcript'
import type { TimelineEvent } from '../../src/shared/contracts'

describe('transcript identities and tool associations', () => {
  it('pairs delayed and out-of-order results by explicit id, preserving orphans and references', () => {
    const a: TimelineEvent = { id: 'a', kind: 'tool-use', toolCallId: 'call-a', toolName: 'Read' }
    const b: TimelineEvent = { id: 'b', kind: 'tool-use', toolCallId: 'call-b', toolName: 'Read' }
    const result: TimelineEvent = {
      id: 'result',
      kind: 'tool-result',
      toolCallId: 'call-a',
      toolResult: 'secret needle',
      isError: true
    }
    const orphan: TimelineEvent = { id: 'orphan', kind: 'tool-result', toolResult: 'unassociated' }
    const paired = pairToolEvents([result, a, b, orphan])
    expect(paired).toHaveLength(3)
    expect(paired[0]).toMatchObject({ id: 'a', toolResultId: 'result', isError: true })
    expect(paired[1]).toBe(b)
    expect(paired[2]).toBe(orphan)
    expect(pairToolEvents([a, b, result])[0]).toBe(paired[0])
    expect(searchableEvent(paired[0]!)).toContain('secret needle')
  })

  it('replays stable ids and preserves tool and parent associations', () => {
    const raw = {
      type: 'assistant',
      parentUuid: 'parent',
      message: {
        content: [{ type: 'tool_use', id: 'call', name: 'Read', input: { path: '/tmp/a' } }]
      }
    }
    const first = normalizeTranscriptEvent(raw, 12)
    expect(normalizeTranscriptEvent(raw, 12)).toEqual(first)
    expect(first[0]).toMatchObject({ toolCallId: 'call', parentId: 'parent' })
    expect(normalizeTranscriptEvent(raw)[0]?.id).toBe(normalizeTranscriptEvent(raw)[0]?.id)
  })
})
