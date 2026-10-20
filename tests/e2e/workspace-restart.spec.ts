import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

test('full process restart restores draft, readonly session and layout without network', async () => {
  test.setTimeout(60000)
  const userData = resolve('test-results', `restart-${Date.now()}`)
  const launch = async () => {
    const app = await electron.launch({
      args: [resolve('tests/e2e/offline-entry.mjs')],
      env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userData }
    })
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            typeof (globalThis as unknown as { resumeOfflineRenderer?: () => Promise<void> })
              .resumeOfflineRenderer
        )
      )
      .toBe('function')
    await fixture(app)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    return app
  }
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await page.locator('.cm-content').fill('Draft preserved across full process restart')
    const sash = page.getByRole('separator', { name: '调整侧栏宽度' })
    await sash.focus()
    await sash.press('ArrowRight')
    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '以只读方式打开' }).click()
    await expect(page.locator('.workspace-notice')).toContainText('只读观察')
  } finally {
    await app.close()
  }
  const reopened = await launch()
  try {
    const page = await reopened.firstWindow()
    await expect(page.locator('.workspace-notice')).toContainText('只读观察')
    await expect(page.locator('.cm-content')).toContainText(
      'Draft preserved across full process restart'
    )
    await expect(page.locator('.send-button')).toBeDisabled()
    await expect(page.getByRole('separator', { name: '调整侧栏宽度' })).toHaveAttribute(
      'aria-valuenow',
      '268'
    )
  } finally {
    await reopened.close()
  }
})
