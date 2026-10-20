import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

test('Windows activation restores the window and selects the notification chat', async () => {
  test.skip(process.platform !== 'win32', 'Windows notification activation')
  const app = await electron.launch({
    args: [resolve('tests/e2e/notification-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: test.info().outputPath('profile')
    }
  })
  try {
    await fixture(app)
    await app.evaluate(() =>
      (globalThis as unknown as { resumeOfflineRenderer: () => void }).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await page.locator('.cm-content').fill('Preserve this draft')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide())
    await app.evaluate(() => {
      const activate = (
        globalThis as unknown as {
          activateTestNotification: (details: { type: string; arguments: string }) => void
        }
      ).activateTestNotification
      activate({ type: 'click', arguments: '' })
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocused())
      )
      .toBe(true)
    await expect(page.locator('.cm-content')).toHaveText('Preserve this draft')

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())
      )
      .toBe(true)
    await app.evaluate(() => {
      const activate = (
        globalThis as unknown as {
          activateTestNotification: (details: { type: string; arguments: string }) => void
        }
      ).activateTestNotification
      activate({
        type: 'click',
        arguments: 'type=click&tag=test&profileId=exp&sessionName=claude-review'
      })
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          return {
            visible: window.isVisible(),
            minimized: window.isMinimized(),
            focused: window.isFocused()
          }
        })
      )
      .toEqual({ visible: true, minimized: false, focused: true })
    await expect(page.locator('.workspace-endpoint')).toHaveText('exp')
    await expect(page.locator('.workspace-title h1')).toHaveText('claude-review')
  } finally {
    await app.close()
  }
})
