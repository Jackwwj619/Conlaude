import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('real project groups, keyboard search and activity filters preserve the working session', async () => {
  test.setTimeout(90000)
  const folder = resolve('playwright-report/workspace-navigation')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `profile-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain, BrowserWindow }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, id) =>
        id === 'mas'
          ? [
              {
                name: 'claude-review',
                windows: 1,
                attachedClients: 0,
                currentPath: '/srv/api-service',
                isClaude: true
              },
              {
                name: 'claude-check',
                windows: 1,
                attachedClients: 0,
                currentPath: '/srv/web-client',
                isClaude: true
              }
            ]
          : [
              {
                name: 'claude-review',
                windows: 1,
                attachedClients: 0,
                currentPath: '/srv/Experiments',
                isClaude: true
              }
            ]
      )
      BrowserWindow.getAllWindows()[0]!.webContents.setBackgroundThrottling(false)
    }, IPC.sessionsList)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    const api = page.getByRole('button', { name: 'api-service', exact: true })
    const web = page.getByRole('button', { name: 'web-client', exact: true })
    await expect(api).toBeVisible()
    await expect(web).toBeVisible()
    const review = page.locator('.session-entry').filter({ hasText: 'claude-review' })
    const check = page.locator('.session-entry').filter({ hasText: 'claude-check' })
    await review.click()
    await page.locator('.cm-content').fill('保留在 API 项目的草稿')
    await api.click()
    await expect(review).toBeHidden()
    await expect(check).toBeVisible()
    await page.keyboard.press('Control+k')
    const search = page.locator('.sidebar-search input')
    await search.fill('claude-check')
    await search.press('Enter')
    await expect(check).toHaveAttribute('aria-current', 'page')
    await expect(search).toHaveValue('')
    await expect(api).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Control+k')
    await search.fill('claude-review')
    await search.press('ArrowDown')
    await expect(review).toBeFocused()
    await review.press('Enter')
    await expect(page.locator('.cm-content')).toHaveText('保留在 API 项目的草稿')
    await expect(search).toHaveValue('')
    await api.click()
    const target = { profileId: 'mas', sessionName: 'claude-review' }
    await command(app, { type: 'status', target, status: { generating: true } })
    await command(app, {
      type: 'status',
      target: { ...target, sessionName: 'claude-check' },
      status: { promptState: 'confirmation' }
    })
    const filters = page.locator('.workspace-activity-filters')
    await expect(filters).toContainText('运行中 1')
    await expect(filters).toContainText('待处理 1')
    await filters.getByRole('button', { name: '待处理 1', exact: true }).click()
    await expect(review).toHaveCount(0)
    await expect(check).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText('保留在 API 项目的草稿')
    await filters.getByRole('button', { name: '显示全部会话', exact: true }).click()
    await expect(review).toBeVisible()
    await app.evaluate(
      ({ BrowserWindow }, { channel, target }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.send(channel, {
          type: 'transcript-status',
          target,
          status: { state: 'reconnecting', attempt: 1 }
        }),
      { channel: IPC.event, target }
    )
    await expect(page.locator('.transcript-sync-notice')).toContainText('正在自动恢复')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: resolve(folder, 'light-projects.png'), animations: 'disabled' })
    await page.locator('.transcript-sync-notice').getByRole('button', { name: '查看终端' }).click()
    await expect(page.getByRole('button', { name: '分屏', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await app.evaluate(
      ({ BrowserWindow }, { channel, target }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.send(channel, {
          type: 'transcript-status',
          target,
          status: { state: 'live', attempt: 0 }
        }),
      { channel: IPC.event, target }
    )
    await expect(page.locator('.transcript-sync-notice')).toHaveCount(0)
    await page.evaluate(async () => {
      const settings = await window.claudeBridge.settings.get()
      await window.claudeBridge.settings.update({ ...settings, theme: 'dark' })
    })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680))
    await expect(page.locator('.cm-content')).toHaveText('保留在 API 项目的草稿')
    await page.screenshot({ path: resolve(folder, 'dark-compact.png'), animations: 'disabled' })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
    expect(overflow).toBe(false)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
