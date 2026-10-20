import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('SSH file read failure cannot overwrite the file and saving locks the draft', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/ssh-editor-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      let attempts = 0
      ipcMain.removeHandler(channels.profilesGetSshConfig)
      ipcMain.removeHandler(channels.profilesSaveSshConfig)
      ipcMain.handle(channels.profilesGetSshConfig, () => {
        if (++attempts === 1) throw new Error('Permission denied reading config')
        return {
          path: 'C:/Users/demo/.ssh/config',
          content: 'Host exp\n  HostName example.test',
          entries: []
        }
      })
      ipcMain.handle(
        channels.profilesSaveSshConfig,
        (_event, content: string) =>
          new Promise((resolve) => {
            ;(globalThis as unknown as { finishSshSave: () => void }).finishSshSave = () =>
              resolve({ path: 'C:/Users/demo/.ssh/config', content, entries: [] })
          })
      )
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '服务器', exact: true }).click()
    const open = page.getByRole('button', { name: '编辑 ~/.ssh/config', exact: true })
    await open.click()
    const dialog = page.locator('.ssh-config-modal')
    const save = dialog.getByRole('button', { name: '保存到 ~/.ssh/config', exact: true })
    await expect(dialog.getByRole('alert')).toContainText('Permission denied')
    await expect(save).toBeDisabled()
    await expect(dialog.locator('textarea')).toHaveCount(0)
    await dialog.getByRole('button', { name: '重新读取', exact: true }).click()
    const editor = dialog.getByRole('textbox', { name: '配置内容', exact: true })
    await expect(editor).toHaveValue('Host exp\n  HostName example.test')
    await expect(save).toBeDisabled()
    await editor.fill('Host exp\n  HostName changed.example.test')
    await save.click()
    await expect(editor).toBeDisabled()
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await app.evaluate(() =>
      (globalThis as unknown as { finishSshSave: () => void }).finishSshSave()
    )
    await expect(page.locator('.settings-modal')).toBeVisible()
    await expect(open).toBeFocused()
  } finally {
    await app.close()
  }
})
