import { expect, it } from 'vitest'
import {
  resolveRemoteFileReference,
  remarkRemoteFilePaths
} from '../../src/renderer/src/file-navigation'

it('resolves remote references against the conversation directory and strips line annotations', () => {
  expect(resolveRemoteFileReference('/srv/报告%20one.md:12:4', '/other')).toBe('/srv/报告 one.md')
  expect(resolveRemoteFileReference('docs/guide.md#L12C2', '/srv/project')).toBe(
    '/srv/project/docs/guide.md'
  )
  expect(resolveRemoteFileReference('~/README.md', '/srv/project')).toBe('~/README.md')
  for (const path of [
    'C:\\secret.txt',
    'https://example.com/file.md',
    '//host/share',
    'javascript:alert(1)',
    '/tmp/a%00b'
  ])
    expect(resolveRemoteFileReference(path, '/srv/project')).toBeUndefined()
})

it('links bare remote paths without rewriting code blocks or web URLs', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: '输出 /srv/report.md。 https://example.com/a.md' }]
      },
      { type: 'code', value: 'cat /srv/report.md' }
    ]
  }
  remarkRemoteFilePaths()(tree)
  expect(tree.children[0]!.children).toEqual([
    { type: 'text', value: '输出 ' },
    { type: 'link', url: '/srv/report.md', children: [{ type: 'text', value: '/srv/report.md' }] },
    { type: 'text', value: '。 https://example.com/a.md' }
  ])
  expect(tree.children[1]!.value).toBe('cat /srv/report.md')
})
