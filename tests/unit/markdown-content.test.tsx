import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '../../src/renderer/src/components/MarkdownContent'
import { Timeline } from '../../src/renderer/src/components/Timeline'
import { useAppStore } from '../../src/renderer/src/store'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { markdownUrl } from '../../src/renderer/src/markdown-links'
import { ContentBoundary } from '../../src/renderer/src/components/ContentBoundary'
import { RemoteFileOpenContext } from '../../src/renderer/src/file-navigation'

beforeEach(() => useAppStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('conversation content rendering', () => {
  it('opens explicit, inline-code and bare file references through the scoped remote opener', () => {
    const open = vi.fn()
    render(
      <RemoteFileOpenContext.Provider value={open}>
        <MarkdownContent
          text={'[报告](/srv/report.md)\n\n`docs/guide.md`\n\n文件 /srv/plain.md。'}
        />
      </RemoteFileOpenContext.Provider>
    )
    fireEvent.click(screen.getByRole('button', { name: '报告' }))
    fireEvent.click(screen.getByRole('button', { name: 'guide.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'plain.md' }))
    expect(open.mock.calls).toEqual([['/srv/report.md'], ['docs/guide.md'], ['/srv/plain.md']])
  })
  it('keeps directories plain and shows a concise file label with line and full-path hint', () => {
    const { container } = render(
      <RemoteFileOpenContext.Provider value={vi.fn()}>
        <MarkdownContent
          text={
            '目录 /srv/project 和 `/srv/project/` [项目](/srv/project)\n\n[运行入口](/srv/project/cli.py:361)\n\n/srv/project/report.md'
          }
        />
      </RemoteFileOpenContext.Provider>
    )
    expect(screen.queryByRole('button', { name: '项目' })).toBeNull()
    expect(container.querySelectorAll('.markdown-file-link')).toHaveLength(2)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '运行入口 (line 361)' }).parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('/srv/project/cli.py (line 361)')
    expect(screen.getByRole('button', { name: 'report.md' })).toBeVisible()
  })
  it('retains copyable original content when a renderer throws', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    function Broken(): never {
      throw new Error('renderer failed')
    }
    try {
      render(
        <ContentBoundary source="Original **source**">
          <Broken />
        </ContentBoundary>
      )
      expect(screen.getByText('Original **source**')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '复制原文' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('Original **source**'))
    } finally {
      report.mockRestore()
    }
  })
  it('renders highlighted code and copies only the original source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const source = 'const greeting = "你好";\nconsole.log(greeting);'
    const { container } = render(<MarkdownContent text={`\`\`\`typescript\n${source}\n\`\`\``} />)
    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const')
    expect(container.querySelector('pre')?.textContent).toBe(source)
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(source))
    fireEvent.click(screen.getByRole('button', { name: '代码折行' }))
    expect(container.querySelector('pre')).toHaveClass('code-wrap')
  })
  it('shows a copy failure and keeps unknown or unfinished fences readable', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const { container } = render(
      <MarkdownContent text={'```unknown-language\n<script>bad()</script>\npartial'} />
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('pre')).toHaveTextContent('<script>bad()</script>')
    fireEvent.click(screen.getByRole('button', { name: '复制代码' }))
    await waitFor(() =>
      expect(container.querySelector('.copy-error')).toHaveTextContent('复制失败')
    )
  })
  it('renders table alignment, task lists, and math without executing raw HTML', () => {
    const { container } = render(
      <MarkdownContent
        text={
          '| Name | Value |\n| :--- | ---: |\n| test | 42 |\n\n- [x] done\n- [ ] pending\n\n$x^2 + y^2$\n\n<script>alert(1)</script>'
        }
      />
    )
    expect(screen.getByRole('region', { name: '表格，可横向滚动' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '42' })).toHaveStyle({ textAlign: 'right' })
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
  it('copies remote file references, explicitly opens web links, and blocks dangerous URLs', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const openExternal = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('claudeBridge', { app: { openExternal } })
    render(
      <MarkdownContent
        text={
          '[source](src/app.ts:42) [docs](https://example.com/docs) [bad](javascript:alert%281%29) ![remote](https://example.com/a.png)'
        }
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '复制远端文件路径：src/app.ts:42' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('src/app.ts:42'))
    fireEvent.click(screen.getByRole('link', { name: 'docs' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    for (const path of ['/srv/main.py#L24', 'app.ts:42', 'C:/Projects/main.ts', '../src/main.ts'])
      expect(markdownUrl(path)).toBe(path)
    for (const url of [
      'javascript:alert(1)',
      'file:///secret',
      '//example.com',
      'data:text/html,test'
    ])
      expect(markdownUrl(url)).toBe('')
  })
  it('preserves literal user text while formatting assistant replies and exposing tool errors', () => {
    const { container } = render(
      <Timeline
        connected
        events={[
          { id: 'user', kind: 'user', text: '**literal**\n- keep text' },
          { id: 'reply', kind: 'assistant', text: '**formatted**', isFinal: true },
          { id: 'error', kind: 'tool-result', isError: true, toolResult: 'Permission denied' }
        ]}
      />
    )
    expect(container.querySelector('.user strong')).toBeNull()
    expect(container.querySelector('.user-message-text')?.textContent).toBe(
      '**literal**\n- keep text'
    )
    expect(container.querySelector('.assistant strong')).toHaveTextContent('formatted')
    expect(container.querySelector('.activity-errors')).toHaveTextContent('1 项失败')
    const group = container.querySelector('details')!
    group.open = true
    fireEvent(group, new Event('toggle'))
    expect(container.querySelector('.tool-card.error pre')).toHaveTextContent('Permission denied')
  })
})
