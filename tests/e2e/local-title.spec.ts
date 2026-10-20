import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('local titles preserve and display the original remote name across reload', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_TEST_HIDDEN: '1',
      CLB_USER_DATA_DIR: resolve(`test-results/local-title-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channel) => {
      const state = globalThis as unknown as { renameCalls: number }
      state.renameCalls = 0
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => {
        state.renameCalls++
        throw new Error('Local title must not rename remote session')
      })
    }, IPC.sessionsRename)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const edit = async () => {
      await page.locator('.session-menu > summary').click()
      await page.getByRole('button', { name: '修改标题', exact: true }).click()
    }
    await edit()
    await expect(page.locator('.title-edit-original code')).toHaveText('claude-review')
    await page.getByRole('textbox', { name: '本地显示标题', exact: true }).fill('My local review')
    await page.locator('.title-edit-modal button[type="submit"]').click()
    await expect(page.locator('.workspace-title h1')).toHaveText('My local review')
    await expect(page.locator('.workspace-title h1')).toHaveAttribute(
      'title',
      /远程原标题: claude-review/
    )
    await page.reload()
    await expect(page.locator('.workspace-title h1')).toHaveText('My local review')
    await edit()
    await expect(page.locator('.title-edit-original code')).toHaveText('claude-review')
    await page.getByRole('textbox', { name: '本地显示标题', exact: true }).fill('')
    await page.locator('.title-edit-modal button[type="submit"]').click()
    await expect(page.locator('.workspace-title h1')).toHaveText('claude-review')
    expect(
      await app.evaluate(() => (globalThis as unknown as { renameCalls: number }).renameCalls)
    ).toBe(0)
  } finally {
    await app.close()
  }
})
