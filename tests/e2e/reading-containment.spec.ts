import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { command, fixture } from './workspace-fixture'

test('a saved paragraph survives remounting a contained long reply', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('playwright-report/freeze-investigation', `anchor-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await command(app, {
      type: 'event',
      target: { profileId: 'mas', sessionName: 'claude-review' },
      event: {
        id: 'long-reply',
        kind: 'assistant',
        text: Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段：保留用户正在阅读的位置。`).join(
          '\n\n'
        )
      }
    })
    await page.waitForFunction(() => document.querySelector('[data-timeline-id="long-reply"]'))
    await page.locator('.timeline').evaluate((node) => {
      node.scrollTop = 120
      node.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => page.locator('.timeline').evaluate((node) => node.scrollTop)).toBe(120)
    await page.locator('.session-entry').filter({ hasText: 'claude-check' }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await expect.poll(() => page.locator('.timeline').evaluate((node) => node.scrollTop)).toBe(120)
  } finally {
    await app.close()
  }
})
