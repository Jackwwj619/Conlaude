import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('long history remains responsive during replay and subsequent output', async () => {
  test.setTimeout(180000)
  const folder = resolve('playwright-report/freeze-investigation')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    executablePath: process.env.CLB_PERF_EXE,
    args: process.env.CLB_PERF_EXE ? [] : ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `profile-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await page.locator('.cm-content').click()
    await page.evaluate(() => {
      const state = window as unknown as { freezeTasks: number[] }
      state.freezeTasks = []
      new PerformanceObserver((list) => {
        state.freezeTasks.push(...list.getEntries().map((entry) => entry.duration))
      }).observe({ type: 'longtask', buffered: false })
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
    const count = Number(process.env.CLB_PERF_COUNT ?? 5000)
    const started = Date.now()
    await app.evaluate(
      ({ BrowserWindow }, { channel, count }) => {
        const w = BrowserWindow.getAllWindows()[0]!
        const target = { profileId: 'mas', sessionName: 'claude-review' }
        w.webContents.send(channel, { type: 'timeline-reset', target })
        for (let i = 0; i < count; i++) {
          w.webContents.send(channel, {
            type: 'timeline-event',
            target,
            event: {
              id: `freeze-${i}`,
              kind: i % 2 ? 'assistant' : 'user',
              isFinal: true,
              text:
                i % 2
                  ? `## Reply ${i}\n\n${'A representative paragraph of a longer conversation. '.repeat(20)}\n\n\`\`\`python\nprint(${i})\n\`\`\``
                  : `Question ${i}`,
              timestamp: '2026-10-05T08:00:00Z'
            }
          })
        }
      },
      { channel: IPC.event, count }
    )
    const liveInputAt = Date.now()
    await page.keyboard.insertText('Typing during replay')
    const liveInputMs = Date.now() - liveInputAt
    // Poll the app's DOM directly; accessibility snapshots of the entire history
    // taken by locator assertions can otherwise dominate the CPU measurement.
    await page.waitForFunction(
      (id) => document.querySelector(`[data-timeline-id="${id}"]`),
      `freeze-${count - 1}`,
      { timeout: 90000 }
    )
    const replayMs = Date.now() - started
    const inputAt = Date.now()
    await page.locator('.cm-content').fill('Typing after replay')
    const inputMs = Date.now() - inputAt
    const appendAt = Date.now()
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send(channel, {
        type: 'timeline-event',
        target: { profileId: 'mas', sessionName: 'claude-review' },
        event: { id: 'freeze-last', kind: 'assistant', isFinal: true, text: 'Latest response' }
      })
    }, IPC.event)
    await page.waitForFunction(() => document.querySelector('[data-timeline-id="freeze-last"]'))
    const appendMs = Date.now() - appendAt
    const usage = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize,
      longTasks: (window as unknown as { freezeTasks: number[] }).freezeTasks
    }))
    const profile = await cdp.send('Profiler.stop')
    const label = process.env.CLB_PERF_LABEL ?? 'latest'
    await writeFile(resolve(folder, `${label}.cpuprofile`), JSON.stringify(profile.profile))
    const metrics = { count, replayMs, liveInputMs, inputMs, appendMs, ...usage }
    await writeFile(resolve(folder, `${label}.json`), JSON.stringify(metrics, null, 2))
    console.log(JSON.stringify(metrics))
    expect(Math.max(0, ...usage.longTasks)).toBeLessThan(1000)
    expect(liveInputMs).toBeLessThan(1500)
    expect(appendMs).toBeLessThan(1500)
  } finally {
    await app.close()
  }
})
