import { describe, expect, it } from 'vitest'
import { commandSuggestions, parseClaudeCommand } from '../../src/shared/claude-commands'

describe('local slash command routing', () => {
  it('supports parameters and custom commands without treating paths or prose as commands', () => {
    expect(parseClaudeCommand('/model opus')).toBe('model')
    expect(parseClaudeCommand('/plugin:review changes')).toBe('plugin:review')
    for (const text of ['Explain /model', '/tmp/file', '/model\nexplain this', '```/resume```'])
      expect(parseClaudeCommand(text)).toBeUndefined()
  })
  it('suggests names only until the parameter begins', () => {
    expect(commandSuggestions('/re').map(([name]) => name)).toEqual(['resume', 'rewind'])
    expect(commandSuggestions('/model ')).toEqual([])
    expect(commandSuggestions('/')).toHaveLength(13)
  })
})
