import { beforeEach, describe, expect, it } from 'vitest'
import { pruneInputHistory, readInputHistory } from '../../src/renderer/src/composer-history'

beforeEach(() => localStorage.clear())

describe('input history retention', () => {
  it('trims all session histories without touching drafts or unrelated storage', () => {
    localStorage.setItem('clb:history:a:one', JSON.stringify(['new', 'old', 42]))
    localStorage.setItem('clb:history:b:two', JSON.stringify(['latest', 'older']))
    localStorage.setItem('clb:draft:a:one', 'draft')
    localStorage.setItem('clb:workspace:v1', 'workspace')
    pruneInputHistory(localStorage, 1)
    expect(readInputHistory(localStorage, 'clb:history:a:one', 500)).toEqual(['new'])
    expect(readInputHistory(localStorage, 'clb:history:b:two', 500)).toEqual(['latest'])
    expect(localStorage.getItem('clb:draft:a:one')).toBe('draft')
    expect(localStorage.getItem('clb:workspace:v1')).toBe('workspace')
    pruneInputHistory(localStorage, 0)
    expect(localStorage.getItem('clb:history:a:one')).toBeNull()
    expect(localStorage.getItem('clb:history:b:two')).toBeNull()
    expect(localStorage.length).toBe(2)
  })

  it('tolerates malformed or unavailable storage', () => {
    localStorage.setItem('clb:history:a:one', '{broken')
    expect(readInputHistory(localStorage, 'clb:history:a:one', 20)).toEqual([])
    expect(() =>
      pruneInputHistory(
        {
          get length(): number {
            throw new Error('denied')
          }
        } as Storage,
        0
      )
    ).not.toThrow()
  })
})
