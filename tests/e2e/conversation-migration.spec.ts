import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('long history keeps context, tool results, reading anchors and responsive input', async () => {
  test.setTimeout(120000)
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `reading-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const target = { profileId: 'mas', sessionName: 'claude-review' }
    const started = Date.now()
    await app.evaluate(({ BrowserWindow }, channel) => {
      for (let i = 0; i < 240; i++)
        BrowserWindow.getAllWindows()[0]!.webContents.send(channel, {
          type: 'timeline-event',
          target: { profileId: 'mas', sessionName: 'claude-review' },
          event: {
            id: `history-${i}`,
            kind: i % 2 ? 'assistant' : 'user',
            text: `Round ${i}\n\n${'A representative paragraph for stable reading. '.repeat(12)}`,
            isFinal: true
          }
        })
    }, IPC.event)
    await expect(page.locator('[data-timeline-id="history-239"]')).toBeAttached()
    const renderedMs = Date.now() - started
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'paired-call',
        kind: 'tool-use',
        toolName: 'Read',
        toolCallId: 'read-id',
        toolInput: { path: '/tmp/report' }
      }
    })
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'paired-result',
        kind: 'tool-result',
        toolCallId: 'read-id',
        toolResult: 'hidden-search-needle',
        isError: true
      }
    })
    const timeline = page.locator('.timeline')
    await page
      .locator('[data-timeline-id="history-70"]')
      .evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await expect.poll(() => timeline.evaluate((node) => node.scrollTop)).toBeGreaterThan(1000)
    const before = await timeline.evaluate((node) => node.scrollTop)
    await page.keyboard.press('Control+f')
    await page.getByRole('searchbox', { name: '搜索当前对话' }).fill('hidden-search-needle')
    await expect(page.locator('.tool-card-content')).toContainText('hidden-search-needle')
    await expect(page.locator('[data-timeline-id="history-70"]')).toBeAttached()
    await expect(page.locator('.timeline-search')).toContainText('1/1')
    await page.keyboard.press('Escape')
    await expect
      .poll(async () => Math.abs((await timeline.evaluate((node) => node.scrollTop)) - before))
      .toBeLessThan(3)
    await command(app, {
      type: 'event',
      target,
      event: { id: 'late-update', kind: 'assistant', text: 'A new response', isFinal: true }
    })
    await expect
      .poll(async () => Math.abs((await timeline.evaluate((node) => node.scrollTop)) - before))
      .toBeLessThan(3)
    await expect(page.locator('.timeline-jump-to-latest')).toContainText('有新内容')
    await page.locator('.cm-content').fill('Continuing to type with a long loaded history')
    await expect(page.locator('.cm-content')).toContainText('Continuing')
    const anchorBefore = await page
      .locator('[data-timeline-id="history-70"]')
      .evaluate((node) => node.getBoundingClientRect().top)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1180, 800))
    await expect
      .poll(async () =>
        Math.abs(
          (await page
            .locator('[data-timeline-id="history-70"]')
            .evaluate((node) => node.getBoundingClientRect().top)) - anchorBefore
        )
      )
      .toBeLessThan(5)
    const metrics = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize
    }))
    const anchored = page.locator('[data-timeline-id="history-70"]')
    const checkAnchor = async (): Promise<void> => {
      await expect
        .poll(async () =>
          Math.abs(
            (await anchored.evaluate((node) => node.getBoundingClientRect().top)) - anchorBefore
          )
        )
        .toBeLessThan(5)
    }
    await page
      .locator('.activity-group')
      .first()
      .evaluate((node: HTMLDetailsElement) => {
        node.open = true
      })
    await checkAnchor()
    await page.locator('.cm-content').fill('Long draft\n'.repeat(35))
    await checkAnchor()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '外观', exact: true }).click()
    await page.getByLabel('回复字号', { exact: true }).fill('18')
    await page.getByLabel('回复字号', { exact: true }).press('Tab')
    await page.getByLabel('回复行距', { exact: true }).fill('1.9')
    await page.getByLabel('回复行距', { exact: true }).press('Tab')
    await page.keyboard.press('Escape')
    await checkAnchor()
    const sidebar = page.getByRole('separator', { name: '调整侧栏宽度' })
    await sidebar.focus()
    await sidebar.press('ArrowRight')
    await checkAnchor()
    await page.getByRole('button', { name: '分屏', exact: true }).click()
    await checkAnchor()
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await checkAnchor()
    // Simulate a delayed rendered block above the viewport (e.g. a diagram).
    await page.locator('[data-timeline-id="history-10"]').evaluate((node) => {
      const block = document.createElement('div')
      block.style.height = '240px'
      node.append(block)
    })
    await checkAnchor()
    await page.locator('.session-entry').filter({ hasText: 'claude-check' }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await checkAnchor()
    await expect(page.locator('.cm-content')).toBeFocused()
    await expect(page.locator('.cm-content')).toContainText('Long draft')
    const reply = page.locator('[data-timeline-id="history-1"]')
    await reply.getByRole('button', { name: '复制纯文本', exact: true }).click()
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Round 1')
    expect(copied).not.toContain('复制')
    await test.info().attach('history-performance', {
      body: JSON.stringify({ events: 240, renderedMs, ...metrics }),
      contentType: 'application/json'
    })
  } finally {
    await app.close()
  }
})
