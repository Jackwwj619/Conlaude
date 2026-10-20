import { _electron as electron, expect, test } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('remote images preview, zoom, report corrupt data, and preserve text editing', async () => {
  test.setTimeout(60000)
  const folder = resolve('playwright-report/image-preview')
  await mkdir(folder, { recursive: true })
  const png = (await readFile(resolve('tests/fixtures/clipboard-red.png'))).toString('base64')
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/image-preview-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(
      ({ ipcMain }, { channels, png }) => {
        ipcMain.removeHandler(channels.filesList)
        ipcMain.handle(channels.filesList, (_event, request) => ({
          path: request.path,
          parent: '/',
          truncated: false,
          entries: ['red.png', 'broken.png', 'notes.txt'].map((name) => ({
            name,
            path: request.path + '/' + name,
            kind: 'file',
            size: 100,
            modified: 0
          }))
        }))
        ipcMain.removeHandler(channels.filesRead)
        ipcMain.handle(channels.filesRead, (_event, request) =>
          request.path.endsWith('.txt')
            ? {
                path: request.path,
                content: 'editable text',
                writable: true,
                lineEnding: 'LF',
                version: 'a'.repeat(64)
              }
            : {
                kind: 'image',
                path: request.path,
                dataUrl:
                  'data:image/png;base64,' + (request.path.endsWith('broken.png') ? 'broken' : png),
                mime: 'image/png',
                bytes: 150,
                writable: false,
                version: 'a'.repeat(64)
              }
        )
      },
      { channels: IPC, png }
    )
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Experiments · exp', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await page.getByRole('button', { name: '右侧栏', exact: true }).click()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    const panel = page.locator('#remote-files-panel')
    await expect(panel.locator('.remote-file-browser')).toBeVisible()
    await panel.getByRole('button', { name: 'red.png', exact: true }).click()
    const image = panel.getByRole('img', { name: 'red.png' })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(100)
    await expect(panel.locator('.remote-file-editor-footer')).toContainText('100 × 60')
    await expect(panel.getByRole('button', { name: '保存', exact: true })).toBeHidden()
    await panel.getByRole('button', { name: '100%', exact: true }).click()
    await panel.getByRole('button', { name: '放大', exact: true }).click()
    await expect(image).toHaveCSS('width', '125px')
    await panel.getByRole('button', { name: '适应窗口', exact: true }).click()
    await expect(image).toHaveClass('fit')
    await panel.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished))
    )
    await page.screenshot({ path: resolve(folder, 'preview.png') })
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    await panel.getByRole('button', { name: 'broken.png', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('文件可能已损坏')
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    await panel.getByRole('button', { name: 'notes.txt', exact: true }).click()
    await expect(panel.getByRole('textbox', { name: '文件内容' })).toHaveValue('editable text')
    await panel.getByRole('textbox', { name: '文件内容' }).fill('keep this draft')
    if (!(await panel.locator('.remote-file-browser').isVisible()))
      await page
        .locator('.panel-tool-rail')
        .getByRole('button', { name: '文件', exact: true })
        .click()
    await panel.getByRole('button', { name: 'red.png', exact: true }).click()
    await expect(panel.getByRole('img', { name: 'red.png' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'red.png', exact: true })).toHaveCount(1)
    await page.getByRole('tab', { name: 'notes.txt', exact: true }).click()
    await expect(panel.getByRole('textbox', { name: '文件内容' })).toHaveValue('keep this draft')
    await page.getByRole('button', { name: '关闭 notes.txt', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '尚有未保存内容' })).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(panel.getByRole('textbox', { name: '文件内容' })).toHaveValue('keep this draft')
    await page.getByRole('button', { name: '关闭 notes.txt', exact: true }).click()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'notes.txt', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: 'red.png', exact: true }).click()
    await expect(panel.getByRole('img', { name: 'red.png' })).toBeVisible()
  } finally {
    await app.close()
  }
})
