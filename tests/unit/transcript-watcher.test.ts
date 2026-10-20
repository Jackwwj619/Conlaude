import { describe, expect, it } from 'vitest'
import { selectTranscript } from '../../src/main/transcript-watcher'

describe('transcript association', () => {
  it('waits for an explicitly mapped transcript even before the file exists', () => {
    expect(
      selectTranscript({
        boundSessionId: '99421998-21de-45b7-9d35-e4ff9452c0e1',
        binding: 'mapping',
        candidates: []
      })
    ).toEqual({
      sessionId: '99421998-21de-45b7-9d35-e4ff9452c0e1',
      waitForFile: true
    })
  })

  it('accepts only one unclaimed heuristic candidate', () => {
    expect(
      selectTranscript({
        binding: 'heuristic',
        candidates: [{ sessionId: 'only', modifiedAt: 1, bytes: 2 }]
      })
    ).toEqual({ sessionId: 'only', waitForFile: false })
  })

  it('refuses to guess between multiple heuristic candidates', () => {
    expect(
      selectTranscript({
        binding: 'heuristic',
        candidates: [
          { sessionId: 'first', modifiedAt: 2, bytes: 2 },
          { sessionId: 'second', modifiedAt: 1, bytes: 2 }
        ]
      })
    ).toBeUndefined()
  })
})
