import { describe, expect, it } from 'vitest'
import { findSearchRanges } from '../../src/renderer/src/search-ranges'

describe('conversation search ranges', () => {
  it('keeps Unicode offsets stable and treats queries as literal text', () => {
    const element = document.createElement('article')
    element.innerHTML = '<p>İstanbul 😀 [a+b] 示例 A+B</p><p>another</p><p>paragraph</p>'
    expect(findSearchRanges(element, 'a+b').map((range) => range.toString())).toEqual([
      'a+b',
      'A+B'
    ])
    expect(findSearchRanges(element, 'anotherparagraph')).toEqual([])
    expect(findSearchRanges(element, '😀')[0]!.toString()).toBe('😀')
  })
  it('finds every occurrence including inline emphasis and excludes action labels', () => {
    const element = document.createElement('article')
    element.innerHTML =
      '<p>Hello <strong>world</strong>.</p><p>Hello world. Hello world.</p><button>Hello world</button>'
    const ranges = findSearchRanges(element, 'hello world')
    expect(ranges.map((range) => range.toString())).toEqual([
      'Hello world',
      'Hello world',
      'Hello world'
    ])
    expect(ranges[0]!.startContainer).not.toBe(ranges[0]!.endContainer)
    expect(findSearchRanges(element, '')).toEqual([])
  })
})
