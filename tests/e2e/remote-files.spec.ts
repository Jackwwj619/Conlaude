import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('remote files browse on demand, preserve edits on conflict, and adapt to dark and narrow layouts', async () => {
  test.setTimeout(60000)
  const folder = resolve('playwright-report/remote-files')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/remote-files-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      let saves = 0
      const entry = (path: string, name: string, kind = 'file') => ({
        path: `${path}/${name}`,
        name,
        kind,
        size: 512,
        modified: Date.now()
      })
      ipcMain.removeHandler(channels.filesList)
      ipcMain.handle(channels.filesList, (_event, request) => {
        if (request.path === '/missing') throw new Error('NOT_FOUND')
        return {
          path: request.path,
          parent: '/',
          truncated: false,
          entries: [
            entry(request.path, 'docs', 'directory'),
            entry(request.path, 'experiments', 'directory'),
            entry(request.path, 'README.md'),
            entry(request.path, 'config.yaml'),
            entry(request.path, '.env'),
            entry(request.path, 'image.png')
          ]
        }
      })
      ipcMain.removeHandler(channels.filesRead)
      ipcMain.handle(channels.filesRead, (_event, request) => {
        if (request.path.endsWith('.png')) throw new Error('NOT_TEXT')
        return {
          path: request.path,
          content:
            '# Project notes\n\n这是项目的说明文件。\n\n## Quick start\n\n| task | gaps flagged | confirmed exploits | channels | patches accepted | tokens | sec |\n| --- | --- | --- | --- | --- | --- | --- |\n| `ablation_hacking` | 9 | 4 | D, E, M | 2 | 48.6k | 391 |\n\n$x^2$\n\n```python\nprint(42)\n```\n',
          version: (saves ? 'b' : 'a').repeat(64),
          writable: true,
          lineEnding: 'LF'
        }
      })
      ipcMain.removeHandler(channels.filesSave)
      ipcMain.handle(channels.filesSave, async (_event, request) => {
        if (++saves === 1) throw new Error('CONFLICT')
        if (request.version !== 'b'.repeat(64)) throw new Error('CONFLICT')
        await new Promise((done) => setTimeout(done, 200))
        return {
          path: request.path,
          content: request.content,
          version: 'b'.repeat(64),
          writable: true,
          lineEnding: 'LF'
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
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const trigger = page.getByRole('button', { name: '右侧栏', exact: true })
    await trigger.click()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    const dialog = page.getByRole('complementary', { name: '远程文件', exact: true })
    const row = (name: string) => dialog.getByRole('button', { name, exact: true }).first()
    const closeButton = page.getByRole('button', { name: '关闭右侧栏' })
    await expect(closeButton).toBeVisible()
    await expect(row('README.md')).toBeVisible()
    await expect(row('.env')).toHaveCount(0)
    await dialog.getByRole('button', { name: '显示隐藏文件' }).click()
    await expect(row('.env')).toBeVisible()
    await row('docs').click()
    await expect(dialog.getByRole('textbox', { name: '文件夹路径' })).toHaveValue(
      '/home/user/project/docs'
    )
    await row('README.md').click()
    await expect(dialog.getByRole('heading', { name: 'Project notes' })).toBeVisible()
    await expect(page.getByRole('tab', { selected: true })).toContainText('README.md')
    await expect(
      dialog.getByRole('textbox', { name: '文件夹路径', includeHidden: true })
    ).toHaveValue(/\/docs$/)
    await expect(dialog.locator('.markdown-content table')).toBeVisible()
    await expect(dialog.locator('.katex')).toBeVisible()
    const composer = page.locator('.composer-editor .cm-content')
    await composer.fill('文件预览时仍可继续对话')
    await expect(composer).toHaveText('文件预览时仍可继续对话')
    const chat = page.locator('.timeline .markdown-content').first()
    await expect(dialog.locator('.markdown-content')).toHaveCSS(
      'font-size',
      await chat.evaluate((element) => getComputedStyle(element).fontSize)
    )
    await expect(dialog.locator('.markdown-content')).toHaveCSS(
      'font-family',
      await chat.evaluate((element) => getComputedStyle(element).fontFamily)
    )
    const chatBox = await page.locator('.files-open > .workspace').boundingBox()
    const fileBox = await dialog.boundingBox()
    expect(fileBox!.x).toBeGreaterThanOrEqual(chatBox!.x + chatBox!.width - 1)
    await page.getByRole('separator', { name: '调整右侧栏宽度' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect
      .poll(async () => (await dialog.boundingBox())!.width)
      .toBeGreaterThan(fileBox!.width)
    await expect(dialog.getByRole('region', { name: '文件夹浏览' })).toBeHidden()
    const table = dialog.locator('.markdown-table-scroll')
    expect(await table.evaluate((el) => el.scrollWidth)).toBeGreaterThan(
      await table.evaluate((el) => el.clientWidth)
    )
    const tab = page.getByRole('tab', { name: 'README.md', exact: true })
    await expect(tab).toHaveCSS('font-size', '12px')
    await expect(dialog.locator('.markdown-content th').first()).toHaveCSS('word-break', 'normal')
    await dialog.getByRole('button', { name: '目录侧栏' }).click()
    const browser = dialog.locator('.remote-directory-browser')
    expect((await browser.boundingBox())!.width).toBeLessThan((await dialog.boundingBox())!.width)
    await page.screenshot({ path: resolve(folder, 'light.png') })
    await dialog.getByRole('button', { name: '目录侧栏' }).click()
    await dialog.getByRole('button', { name: '编辑', exact: true }).click()
    const editor = dialog.getByRole('textbox', { name: '文件内容' })
    await expect(editor).toContainText('这是项目')
    await editor.fill('中文修改\nsecond line')
    await dialog.getByRole('button', { name: '预览', exact: true }).click()
    await expect(dialog.locator('.markdown-content')).toContainText('中文修改')
    await dialog.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(editor).toHaveValue('中文修改\nsecond line')
    await editor.focus()
    await page.keyboard.press('Control+s')
    await expect(dialog.getByRole('alert')).toContainText('远端文件已变化')
    await expect(editor).toHaveValue('中文修改\nsecond line')
    await dialog.getByRole('button', { name: '关闭 README.md', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '尚有未保存内容' })).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await dialog.getByRole('button', { name: '文件操作' }).click()
    await page.getByRole('menuitem', { name: '重新读取' }).click()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(editor).toContainText('这是项目')
    await editor.fill('中文修改\nsecond line')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog.getByText('已保存')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '目录侧栏' }).click()
    await row('image.png').click()
    await expect(dialog.getByRole('alert')).toContainText('无法预览')
    await page.getByRole('button', { name: '关闭 image.png', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'image.png', exact: true })).toHaveCount(0)
    await expect(editor).toHaveValue('中文修改\nsecond line')
    await command(app, {
      type: 'status',
      target: { profileId: 'mas', sessionName: 'claude-review' },
      status: { readOnly: true }
    })
    await expect(editor).toHaveAttribute('readonly', '')
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(238, 241, 247)')
    await page.screenshot({ path: resolve(folder, 'dark.png') })
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setMinimumSize(500, 500)
      win.setSize(650, 720)
    })
    await page.screenshot({ path: resolve(folder, 'narrow.png') })
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    )
    await closeButton.click()
    await expect(dialog).toBeHidden()
    await trigger.click()
    await expect(dialog).toBeVisible()
  } finally {
    await app.close()
  }
})

test('file sidebar closes immediately during pending reads and ignores stale responses after reopening', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/remote-files-loading-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      const fixtureState = globalThis as unknown as {
        finishFileList: () => void
        finishFileRead: () => void
      }
      let lists = 0
      ipcMain.removeHandler(channels.filesList)
      ipcMain.handle(channels.filesList, (_event, request) => {
        const result = {
          path: request.path,
          parent: '/',
          truncated: false,
          entries: [
            {
              name: 'config.txt',
              path: `${request.path}/config.txt`,
              kind: 'file',
              size: 12,
              modified: 0
            }
          ]
        }
        if (++lists === 1)
          return new Promise((done) => {
            fixtureState.finishFileList = () => done({ ...result, path: '/stale' })
          })
        return result
      })
      ipcMain.removeHandler(channels.filesRead)
      ipcMain.handle(
        channels.filesRead,
        (_event, request) =>
          new Promise((done) => {
            fixtureState.finishFileRead = () =>
              done({
                path: request.path,
                content: 'stale file',
                version: 'a'.repeat(64),
                writable: true,
                lineEnding: 'LF'
              })
          })
      )
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const trigger = page.getByRole('button', { name: '右侧栏', exact: true })
    const panel = page.locator('#remote-files-panel')
    const openFiles = async () => {
      if (!(await page.locator('.panel-tool-rail').isVisible())) await trigger.click()
      await page
        .locator('.panel-tool-rail')
        .getByRole('button', { name: '文件', exact: true })
        .click()
    }
    await openFiles()
    await expect(panel.getByText('正在读取目录…')).toBeVisible()
    // A new location supersedes a pending listing; the stale result is ignored.
    await panel.getByRole('textbox', { name: '文件夹路径' }).fill('/fresh')
    await panel.getByRole('button', { name: '前往', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'config.txt', exact: true })).toBeVisible()
    await app.evaluate(() =>
      (globalThis as unknown as { finishFileList: () => void }).finishFileList()
    )
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/fresh')
    await panel.getByRole('button', { name: 'config.txt', exact: true }).click()
    await panel.getByRole('button', { name: '关闭 config.txt', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'config.txt', exact: true })).toBeVisible()
    await app.evaluate(() =>
      (globalThis as unknown as { finishFileRead: () => void }).finishFileRead()
    )
    await expect(panel.getByText('stale file', { exact: true })).toHaveCount(0)
    await expect(panel.getByRole('tab')).toHaveCount(0)
    await page.getByRole('button', { name: '关闭右侧栏' }).click()
  } finally {
    await app.close()
  }
})
