import { describe, expect, it } from 'vitest'
import { encodePromptForTerminal, sanitizePrompt } from '../../src/shared/prompt'

describe('prompt encoding', () => {
  it('normalizes Windows line endings and preserves tabs and Unicode', () => {
    expect(sanitizePrompt('你好\r\n\tworld\rnext')).toEqual({
      text: '你好\n\tworld\nnext',
      removedControlCharacters: 0
    })
  })

  it('removes terminal control characters and NUL', () => {
    expect(sanitizePrompt('safe\u001b[31m\0bad\u007f')).toEqual({
      text: 'safe[31mbad',
      removedControlCharacters: 3
    })
  })

  it('uses one bracketed-paste sequence followed by enter', () => {
    const encoded = encodePromptForTerminal('line 1\nline 2')
    expect(encoded.sequence).toBe('\u001b[200~line 1\nline 2\u001b[201~\r')
  })
})
