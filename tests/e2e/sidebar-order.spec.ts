import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('drag server, folder and chat order survives refresh, selection and restart', async () => {
  test.setTimeout(60000)
  const data = resolve(`test-results/sidebar-order-${Date.now()}`)
  const launch = async () => {
    const app = await electron.launch({
      args: [resolve('tests/e2e/offline-entry.mjs')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CLB_TEST_HIDDEN: '1',
        CLB_USER_DATA_DIR: data
      }
    })
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      ipcMain.removeHandler(channels.sessionsList)
      ipcMain.handle(channels.sessionsList, () => [
        { name: 'chat-a', windows: 1, attachedClients: 0, currentPath: '/srv/main' },
        { name: 'chat-b', windows: 1, attachedClients: 0, currentPath: '/srv/main' },
        { name: 'chat-c', windows: 1, attachedClients: 0, currentPath: '/srv/main' },
        { name: 'other-chat', windows: 1, attachedClients: 0, currentPath: '/srv/other' }
      ])
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    return app
  }
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '底部栏', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '右侧栏', exact: true })).toBeVisible()
    const servers = page.locator('.sidebar-server')
    await servers.nth(1).dragTo(servers.nth(0), { targetPosition: { x: 50, y: 3 } })
    await expect(servers.first()).toHaveAttribute('aria-controls', 'server-projects-exp')
    const mas = page
      .locator('.project-group')
      .filter({ has: page.locator('[aria-controls="server-projects-mas"]') })
    await mas.locator('.sidebar-server').click()
    const main = mas.locator('[data-directory="/srv/main"]')
    const other = mas.locator('[data-directory="/srv/other"]')
    await expect(main.locator('.session-entry')).toHaveCount(3)
    await other
      .locator('.project-heading')
      .dragTo(main.locator('.project-heading'), { targetPosition: { x: 50, y: 3 } })
    await expect(mas.locator('.session-project-group').first()).toHaveAttribute(
      'data-directory',
      '/srv/other'
    )
    await main
      .locator('.session-entry')
      .filter({ hasText: 'chat-c' })
      .dragTo(main.locator('.session-entry').filter({ hasText: 'chat-a' }), {
        targetPosition: { x: 50, y: 3 }
      })
    await expect(main.locator('.session-copy strong')).toHaveText(['chat-c', 'chat-a', 'chat-b'])
    await main
      .locator('.session-entry')
      .filter({ hasText: 'chat-c' })
      .dragTo(other.locator('.session-entry'), { targetPosition: { x: 50, y: 3 } })
    await expect(main.locator('.session-copy strong')).toHaveText(['chat-c', 'chat-a', 'chat-b'])
    // A later visit must not put the most recently opened chat above manual order.
    await main.locator('.session-entry').filter({ hasText: 'chat-b' }).click()
    await expect(main.locator('.session-entry.selected')).toHaveCSS('box-shadow', 'none')
    await expect(main.locator('.session-copy strong')).toHaveText(['chat-c', 'chat-a', 'chat-b'])
    await page.screenshot({ path: test.info().outputPath('sidebar-order.png') })
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.locator('.sidebar-server').first()).toHaveAttribute(
      'aria-controls',
      'server-projects-exp'
    )
    const restored = page.locator('#server-projects-mas')
    await expect(restored.locator('.session-project-group').first()).toHaveAttribute(
      'data-directory',
      '/srv/other'
    )
    await expect(restored.locator('[data-directory="/srv/main"] .session-copy strong')).toHaveText([
      'chat-c',
      'chat-a',
      'chat-b'
    ])
    await expect(page.locator('.xterm-host')).toHaveCount(1)
    const last = restored
      .locator('[data-directory="/srv/main"] .session-entry')
      .filter({ hasText: 'chat-b' })
    await last.press('Alt+Shift+ArrowUp')
    await expect(restored.locator('[data-directory="/srv/main"] .session-copy strong')).toHaveText([
      'chat-c',
      'chat-b',
      'chat-a'
    ])
  } finally {
    await app.close()
  }
})

test('tray shortcuts open their corresponding screens in the existing window', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_TEST_HIDDEN: '1',
      CLB_USER_DATA_DIR: resolve(`test-results/tray-actions-${Date.now()}`)
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
    await expect(page.locator('.app-shell')).toBeVisible()
    const open = async (action: string) =>
      app.evaluate(({ BrowserWindow }, action) => {
        BrowserWindow.getAllWindows()[0]!.webContents.send('bridge:event', {
          type: 'app-action',
          action
        })
      }, action)
    await open('settings')
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="dialog"]')).toBeHidden()
    await open('new-chat')
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.locator('[role="dialog"] input').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await open('servers')
    await expect(page.locator('.library-frame')).toBeVisible()
    await open('diagnostics')
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())
    ).toBe(false)
  } finally {
    await app.close()
  }
})
