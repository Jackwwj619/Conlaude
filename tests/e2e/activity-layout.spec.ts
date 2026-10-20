import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { normalizeTranscriptEvent } from '../../src/shared/transcript'
import type { TimelineEvent } from '../../src/shared/contracts'

test('activity hides empty metadata and keeps command rows compact in wide and narrow layouts', async () => {
  const folder = resolve('playwright-report/activity-layout')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/activity-layout-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const emit = (event: TimelineEvent) =>
      command(app, {
        type: 'event',
        target: { profileId: 'mas', sessionName: 'claude-review' },
        event
      })
    await emit({ id: 'layout-prompt', kind: 'user', text: '检查命令执行过程的排版。' })
    for (const event of normalizeTranscriptEvent({
      type: 'assistant',
      uuid: 'layout-thinking',
      message: { content: [{ type: 'thinking', thinking: '先检查工作区，再运行验证。' }] }
    }))
      await emit(event)
    await emit({ id: 'layout-progress', kind: 'assistant', isFinal: false, text: '开始执行检查。' })
    const commands = [
      'git status --short',
      'rg --files src/renderer/src/components src/renderer/src/styles tests/e2e --glob "*.tsx" --glob "*.css" --glob "*.spec.ts"',
      'npm run typecheck'
    ]
    for (const [index, text] of commands.entries()) {
      await emit({ id: `empty-${index}`, kind: 'status', text: index ? ' \n ' : undefined })
      await emit({
        id: `command-${index}`,
        kind: 'tool-use',
        toolName: 'Bash',
        toolCallId: `call-${index}`,
        toolInput: { command: text }
      })
      await emit({
        id: `result-${index}`,
        kind: 'tool-result',
        toolCallId: `call-${index}`,
        toolResult: index === 1 ? 'src/renderer/src/components/Timeline.tsx' : ''
      })
    }
    await emit({ id: 'layout-final', kind: 'assistant', isFinal: true, text: '检查完成。' })
    const turn = page.locator('.turn-response').last()
    await turn.locator('.turn-summary').click()
    await expect(turn.locator('.activity-status')).toHaveCount(2)
    await expect(turn.getByText('思考过程', { exact: true })).toBeVisible()
    await expect(turn.getByText('执行进展', { exact: true })).toBeVisible()
    await expect(turn.locator('.turn-activity-content .message-copy')).toHaveCount(0)
    await expect(turn.getByRole('button', { name: '复制回复（Markdown 原文）' })).toHaveCount(1)
    const headers = turn.locator('.tool-card-header')
    await expect(headers).toHaveCount(3)
    const checkRows = async () => {
      await headers.last().scrollIntoViewIfNeeded()
      const boxes = await headers.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        })
      )
      for (const [index, box] of boxes.entries()) {
        expect(box.height).toBeLessThanOrEqual(32)
        expect(box.height).toBe(boxes[0]!.height)
        expect(box.x).toBe(boxes[0]!.x)
        expect(box.width).toBe(boxes[0]!.width)
        if (index) expect(box.y - boxes[index - 1]!.y - boxes[index - 1]!.height).toBeCloseTo(4, 0)
      }
    }
    await checkRows()
    await page.screenshot({ path: resolve(folder, 'wide.png') })
    await headers.nth(1).click()
    await expect(turn.locator('.tool-card-content pre').first()).toHaveText(
      JSON.stringify({ command: commands[1] }, null, 2)
    )
    await expect(turn.locator('.tool-card-content')).toContainText(
      'src/renderer/src/components/Timeline.tsx'
    )
    await headers.nth(1).click()
    await headers.first().click()
    await expect(turn.locator('.tool-card-content')).not.toContainText('等待结果')
    await headers.first().click()
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setMinimumSize(650, 600)
      win.setSize(760, 820)
    })
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await checkRows()
    await expect(headers.nth(1).locator('.tool-summary-detail')).toHaveAttribute(
      'title',
      commands[1]!
    )
    await page.screenshot({ path: resolve(folder, 'narrow-dark.png') })
    await emit({
      id: 'result-2',
      kind: 'tool-result',
      toolCallId: 'call-2',
      toolResult: 'Type check failed',
      isError: true
    })
    await expect(turn.locator('.tool-card.error')).toContainText('Type check failed')
  } finally {
    await app.close()
  }
})
