import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { normalizeTranscriptEvent } from '../../src/shared/transcript'
import { IPC } from '../../src/shared/ipc'

test('representative JSONL histories retain search, copy and editor responsiveness', async () => {
  test.setTimeout(150000)
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `history-${Date.now()}`)
    }
  })
  const metrics: unknown[] = []
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    for (const count of [200, 1000]) {
      const rows = Array.from({ length: count }, (_, i) =>
        JSON.stringify({
          uuid: `perf-${i}`,
          type: i % 2 ? 'assistant' : 'user',
          timestamp: '2026-10-04T08:00:00Z',
          message: {
            role: i % 2 ? 'assistant' : 'user',
            content: [
              {
                type: 'text',
                text:
                  i % 10 === 1
                    ? `## Result ${i}\n\n| a | b |\n|---|---|\n|foo|bar|\n\n\`\`\`python\nprint("perf-needle-${i}")\n\`\`\``
                    : `Message ${i}\n\n${'Representative reading paragraph. '.repeat(12)}`
              }
            ]
          }
        })
      )
      const normalizedAt = performance.now()
      const events = rows.flatMap((line, offset) =>
        normalizeTranscriptEvent(JSON.parse(line), offset)
      )
      const normalizedMs = performance.now() - normalizedAt
      const started = Date.now()
      await app.evaluate(
        ({ BrowserWindow }, { events, channel }) => {
          const w = BrowserWindow.getAllWindows()[0]!
          w.webContents.send(channel, {
            type: 'timeline-reset',
            target: { profileId: 'mas', sessionName: 'claude-review' }
          })
          for (const event of events)
            w.webContents.send(channel, {
              type: 'timeline-event',
              target: { profileId: 'mas', sessionName: 'claude-review' },
              event
            })
        },
        { events, channel: IPC.event }
      )
      await expect(page.locator(`[data-timeline-id="perf-${count - 1}-text-0"]`)).toBeAttached({
        timeout: 30000
      })
      const renderMs = Date.now() - started
      const beforeSearch = await cdp.send('Performance.getMetrics')
      const searchAt = Date.now()
      await page.keyboard.press('Control+f')
      await page.locator('.timeline-search input[type="search"]').fill('perf-needle-191')
      await expect(page.locator('.timeline-search')).toContainText('1/1')
      const searchMs = Date.now() - searchAt
      await expect(page.locator('[data-timeline-id="perf-1-text-0"]')).toBeAttached()
      await page.keyboard.press('Escape')
      const inputAt = Date.now()
      await page.locator('.cm-content').fill(`Continue after ${count} events`)
      await expect(page.locator('.cm-content')).toContainText('Continue')
      const inputMs = Date.now() - inputAt
      const afterInput = await cdp.send('Performance.getMetrics')
      const usage = await page.evaluate(() => ({
        nodes: document.querySelectorAll('*').length,
        heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize
      }))
      metrics.push({
        count,
        cpu: Object.fromEntries(
          afterInput.metrics
            .filter((entry) =>
              ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(
                entry.name
              )
            )
            .map((entry) => [
              entry.name,
              entry.value -
                (beforeSearch.metrics.find((before) => before.name === entry.name)?.value ?? 0)
            ])
        ),
        jsonlBytes: Buffer.byteLength(rows.join('\n')),
        normalizedMs,
        renderMs,
        searchMs,
        inputMs,
        ...usage
      })
    }
    await mkdir('playwright-report/codex-frontend-migration', { recursive: true })
    await writeFile(
      'playwright-report/codex-frontend-migration/history-performance.json',
      JSON.stringify(metrics, null, 2)
    )
  } finally {
    await app.close()
  }
})
