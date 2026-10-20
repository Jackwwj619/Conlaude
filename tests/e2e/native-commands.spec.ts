import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('native commands synchronize without a return button and preserve manual navigation', async () => {
  test.setTimeout(90000)
  const root = resolve(import.meta.dirname, '../..')
  const app = await electron.launch({
    ...(process.env.CLB_NATIVE_EXECUTABLE
      ? { executablePath: process.env.CLB_NATIVE_EXECUTABLE, args: [] }
      : { args: ['.'] }),
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(root, 'test-results', `native-commands-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      const requests: string[] = []
      ipcMain.removeHandler(channels.commandsRun)
      ipcMain.handle(channels.commandsRun, (_event, request) => {
        requests.push(request.text)
      })
      ipcMain.removeHandler(channels.commandsFinish)
      ipcMain.handle(channels.commandsFinish, () => undefined)
      Object.assign(globalThis, { nativeCommandRequests: requests })
    }, IPC)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const editor = page.locator('.cm-content')
    await editor.fill('/mo')
    await expect(page.getByRole('listbox', { name: 'Claude 命令' })).toBeVisible()
    const commandFont = await page
      .locator('.composer-command-list code')
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          family: style.fontFamily,
          size: style.fontSize,
          menuFamily: getComputedStyle(element.closest('.composer-command-list')!).fontFamily
        }
      })
    await page.screenshot({
      path: resolve(root, 'playwright-report/native-commands/suggestions-font.png')
    })
    expect(commandFont.size).toBe('13px')
    expect(commandFont.family).toBe(commandFont.menuFamily)
    await editor.press('Tab')
    await expect(editor).toHaveText('/model')
    await expect(page.getByRole('listbox')).toBeHidden()
    await editor.press('Control+Enter')
    await expect(page.getByRole('button', { name: /返回对话|Return to chat/ })).toHaveCount(0)
    await expect(page.locator('.terminal-drawer')).toHaveClass(/open/)
    await editor.fill('操作期间保留的草稿')
    await page.screenshot({ path: resolve(root, 'test-results/native-command-panel.png') })
    await expect(page.locator('.composer-native-hint')).toHaveCount(0)
    await expect(page.locator('.terminal-drawer')).toHaveClass(/open/)
    await expect(editor).toHaveText('操作期间保留的草稿')
    await editor.fill('')
    await editor.press('Escape')
    await editor.press('Escape')
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { nativeCommandRequests: string[] })
              .nativeCommandRequests.length
        )
      )
      .toBe(2)
    const requests = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { nativeCommandRequests: string[] })
          .nativeCommandRequests
    )
    expect(requests.map((value) => value.trim())).toEqual(['/model', '/rewind'])
  } finally {
    await app.close()
  }
})
