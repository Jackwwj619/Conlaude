import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fixture, command } from './workspace-fixture'

test('reading width previews and persists; the centered icon follows only live generation', async () => {
  test.setTimeout(90000)
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `width-status-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 920))
    const target = { profileId: 'mas', sessionName: 'claude-review' }
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'long-reply',
        kind: 'assistant',
        isFinal: true,
        text: '## Reading anchor\n\n' + 'A paragraph that must remain readable.\n\n'.repeat(70)
      }
    })
    const widthBefore = await page
      .locator('.timeline-inner')
      .evaluate((node) => node.getBoundingClientRect().width)
    expect(widthBefore).toBe(820)
    await page.getByRole('button', { name: '切换到全宽阅读', exact: true }).click()
    await expect
      .poll(() =>
        page.locator('.timeline-inner').evaluate((node) => node.getBoundingClientRect().width)
      )
      .toBeGreaterThan(1000)
    await page.getByRole('button', { name: '切换到居中阅读', exact: true }).click()
    await expect
      .poll(() =>
        page.locator('.timeline-inner').evaluate((node) => node.getBoundingClientRect().width)
      )
      .toBe(820)
    const paragraph = page.locator('[data-timeline-id="long-reply"] p').nth(25)
    await paragraph.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    const paragraphTop = await paragraph.evaluate((node) => node.getBoundingClientRect().top)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '对话', exact: true }).last().click()
    await page.getByLabel('对话显示宽度', { exact: true }).selectOption('limited')
    const width = page.getByLabel('最大阅读宽度', { exact: true })
    await width.fill('760')
    await width.press('Tab')
    await expect
      .poll(() =>
        page.locator('.timeline-inner').evaluate((node) => node.getBoundingClientRect().width)
      )
      .toBe(760)
    await expect
      .poll(() =>
        page.locator('.composer-area').evaluate((node) => node.getBoundingClientRect().width)
      )
      .toBe(760)
    await page.keyboard.press('Escape')
    await expect
      .poll(async () =>
        Math.abs(
          (await paragraph.evaluate((node) => node.getBoundingClientRect().top)) - paragraphTop
        )
      )
      .toBeLessThan(5)
    await page.reload()
    await expect
      .poll(() =>
        page.locator('.composer-area').evaluate((node) => node.getBoundingClientRect().width)
      )
      .toBe(760)
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'long-reply',
        kind: 'assistant',
        text: 'Paragraph\n\n'.repeat(90),
        isFinal: true
      }
    })
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'old-incomplete',
        kind: 'assistant',
        text: 'historical intermediate update',
        isFinal: false
      }
    })
    await expect(page.locator('[data-timeline-id="long-reply"]')).toBeAttached()
    await page.locator('.timeline').evaluate((node) => {
      node.scrollTop = 0
    })
    const jump = page.locator('.timeline-jump-to-latest')
    await expect(jump).toBeVisible()
    await expect(jump).toHaveAttribute('data-generating', 'false')
    await command(app, { type: 'status', target, status: { generating: true } })
    await expect(jump.locator('.generating-dots i')).toHaveCount(3)
    await mkdir('playwright-report/codex-frontend-migration/reading-controls', { recursive: true })
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page
          .getByRole('button', { name: theme === 'dark' ? '切换到深色主题' : '切换到浅色主题' })
          .click()
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined))
        )
      )
      await page.screenshot({
        path: `playwright-report/codex-frontend-migration/reading-controls/${theme}-generating.png`
      })
    }
    const alignment = await page.evaluate(() => {
      const a = document.querySelector('.timeline-shell')!.getBoundingClientRect(),
        b = document.querySelector('.timeline-jump-to-latest')!.getBoundingClientRect()
      return {
        offset: Math.abs(a.x + a.width / 2 - b.x - b.width / 2),
        width: b.width,
        height: b.height
      }
    })
    expect(alignment.offset).toBeLessThan(1)
    expect(alignment.width).toBe(alignment.height)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(jump.locator('i').first()).toHaveCSS('animation-name', 'none')
    await command(app, { type: 'status', target, status: { generating: false } })
    await expect(jump.locator('.generating-dots')).toHaveCount(0)
    await page.screenshot({
      path: 'playwright-report/codex-frontend-migration/reading-controls/dark-arrow.png'
    })
    await jump.click()
    await expect
      .poll(() =>
        page.locator('.timeline').evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight)
      )
      .toBeLessThan(2)
    await page.locator('.timeline').evaluate((node) => {
      node.scrollTop = 0
    })
    await command(app, { type: 'status', target, status: { generating: true } })
    await command(app, { type: 'status', target, status: { state: 'detached', generating: true } })
    await expect(jump).toHaveAttribute('data-generating', 'false')
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.setSize(980, 680)
      w.webContents.setZoomFactor(1.5)
    })
    await expect
      .poll(() =>
        page
          .locator('.composer-area')
          .evaluate((n) => n.getBoundingClientRect().right <= innerWidth)
      )
      .toBe(true)
  } finally {
    await app.close()
  }
})
