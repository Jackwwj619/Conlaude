import { expect, it } from 'vitest'
import { renderedPlainText } from '../../src/renderer/src/plain-text'

it('copies prose, code, math and table text without interface labels or duplicate math', () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<h2>Title</h2><p>Hello <strong>world</strong>.</p>' +
    '<div data-code-source="print(1)"><button>Copy code</button><pre>print(1)</pre></div>' +
    '<p><span class="katex"><annotation>x^2</annotation><span>duplicate formula</span></span></p>' +
    '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>' +
    '<span class="copy-control">Copy path</span><p><a>/tmp/report</a></p>'
  const text = renderedPlainText(root)
  expect(text).toContain('Title\nHello world.')
  expect(text.match(/print\(1\)/g)).toHaveLength(1)
  expect(text).toContain('x^2\n')
  expect(text).toContain('A\tB\t\n')
  expect(text).toContain('/tmp/report')
  expect(text).not.toMatch(/Copy|duplicate/)
})
