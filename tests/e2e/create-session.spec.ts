import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { command, fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('New Chat browses the selected server, creates the requested tmux session and connects to it', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: test.info().outputPath('profile') }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      ipcMain.removeHandler(channels.filesList)
      ipcMain.handle(channels.filesList, (_event, request) => {
        if (request.profileId !== 'exp' || request.sessionName)
          throw new Error('Wrong browse target')
        return {
          path: request.path,
          parent: '/srv/Experiments',
          truncated: false,
          entries:
            request.path === '/srv/Experiments'
              ? [
                  {
                    name: '实验 project',
                    path: '/srv/Experiments/实验 project',
                    kind: 'directory',
                    size: 0,
                    modified: 0
                  }
                ]
              : []
        }
      })
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.new-session-button').click()
    const dialog = page.getByRole('dialog', { name: '新建 Claude 会话' })
    await expect(dialog.getByLabel('服务器', { exact: true })).toHaveValue('mas')
    await expect(dialog.getByLabel('tmux 会话名', { exact: true })).toBeVisible()
    await dialog.getByLabel('服务器', { exact: true }).selectOption('exp')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    const server = page.locator('.sidebar-server-wrap').filter({ hasText: 'EXP · Experiments' })
    await expect(server.locator('.server-new-session')).toHaveCSS('opacity', '1')
    await server
      .getByRole('button', { name: '在 EXP · Experiments 上新建会话', exact: true })
      .click()
    await expect(dialog.getByLabel('服务器', { exact: true })).toHaveValue('exp')
    await dialog.getByRole('button', { name: '浏览文件夹', exact: true }).click()
    await dialog.getByRole('button', { name: '实验 project', exact: true }).click()
    await expect(dialog.getByText('没有子文件夹，可选择当前文件夹。')).toBeVisible()
    await dialog.getByRole('button', { name: '上一级文件夹', exact: true }).click()
    await dialog.getByRole('button', { name: '实验 project', exact: true }).click()
    await dialog.getByRole('button', { name: '选择当前文件夹', exact: true }).click()
    await expect(dialog.getByLabel('远程工作目录', { exact: true })).toHaveValue(
      '/srv/Experiments/实验 project'
    )
    await dialog.getByLabel('tmux 会话名', { exact: true }).fill('exp-custom-chat')
    await dialog.getByLabel('会话标题', { exact: true }).fill('跨服务器新会话')
    await page.screenshot({ path: test.info().outputPath('new-chat.png') })
    await dialog.getByRole('button', { name: '创建并连接', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.workspace-header h1')).toHaveText('exp-custom-chat')
    await expect(page.locator('.session-entry.selected')).toContainText('跨服务器新会话')
    await expect(page.locator('.connection-label')).toHaveAccessibleName('已连接')
    const calls = (await command(app, { type: 'calls' })) as {
      channel: string
      request: Record<string, unknown>
    }[]
    expect(calls.find((item) => item.channel === IPC.sessionsCreate)?.request).toEqual({
      profileId: 'exp',
      sessionName: 'exp-custom-chat',
      cwd: '/srv/Experiments/实验 project'
    })
    expect(
      calls.filter((item) => item.channel === IPC.sessionsAttach).at(-1)?.request
    ).toMatchObject({
      profileId: 'exp',
      sessionName: 'exp-custom-chat',
      readOnly: false
    })
    expect(
      await page.evaluate(async () => (await window.claudeBridge.settings.get()).currentProfileId)
    ).toBe('exp')
  } finally {
    await app.close()
  }
})
