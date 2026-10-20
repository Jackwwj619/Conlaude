import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { IPC } from '../../src/shared/ipc'
import { fixture } from './workspace-fixture'

test('compact files prioritize content and preserve drafts across browser and conversation views', async () => {
  test.setTimeout(60000)
  const evidence = resolve('playwright-report/content-priority')
  await mkdir(evidence, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`playwright-report/content-priority-profiles/${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      ipcMain.removeHandler(channels.filesList)
      ipcMain.handle(channels.filesList, (_event, request) => ({
        path: request.path,
        parent: '/',
        truncated: false,
        entries: ['README.md', 'config.yaml'].map((name) => ({
          name,
          path: `${request.path}/${name}`,
          kind: 'file',
          size: 256,
          modified: 0
        }))
      }))
      ipcMain.removeHandler(channels.filesRead)
      ipcMain.handle(channels.filesRead, (_event, request) => ({
        path: request.path,
        content:
          '# 项目说明\n\n正文需要足够的阅读空间，操作控件保持紧凑。\n\n## 当前任务\n\n- 检查窗口布局\n- 保留编辑草稿\n- 支持深色主题\n',
        version: 'a'.repeat(64),
        writable: true,
        lineEnding: 'LF'
      }))
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const composer = page.locator('.cm-content')
    await composer.fill('返回对话后保留这条草稿')
    await page.getByRole('button', { name: '远程文件', exact: true }).click()
    const panel = page.locator('#remote-files-panel')
    const browser = panel.getByRole('region', { name: '文件夹浏览' })
    const treeToggle = panel.getByRole('button', { name: '切换文件树' })
    const editor = panel.getByRole('textbox', { name: '文件内容' })
    await panel.getByRole('button', { name: 'README.md', exact: true }).click()
    await expect(panel.getByRole('heading', { name: '项目说明', exact: true })).toBeVisible()
    await page.screenshot({ path: resolve(evidence, 'wide-light.png') })

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(980, 680))
    await expect(browser).toBeHidden()
    const measurements = await panel.evaluate((el) => {
      const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect()
      return {
        panelWidth: el.clientWidth,
        editorWidth: box('.remote-file-editor').width,
        panelHeight: el.clientHeight,
        contentHeight: box('.remote-file-preview').height,
        chromeHeight: box('.remote-files-header').height + box('.remote-files-navigation').height,
        toolbarOverflow: el.querySelector('.remote-files-navigation')!.scrollWidth > el.clientWidth
      }
    })
    expect(measurements.editorWidth).toBeGreaterThanOrEqual(measurements.panelWidth - 2)
    expect(measurements.contentHeight / measurements.panelHeight).toBeGreaterThan(0.75)
    expect(measurements.chromeHeight).toBeLessThanOrEqual(78)
    expect(measurements.toolbarOverflow).toBe(false)
    await writeFile(resolve(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2))
    await page.screenshot({ path: resolve(evidence, 'compact-light.png') })
    await panel.getByRole('button', { name: '编辑', exact: true }).click()
    await editor.fill('# 未保存的文件草稿\n\n保持原样')
    await treeToggle.click()
    await expect(browser).toBeVisible()
    await expect(editor).toBeHidden()
    await panel.getByRole('button', { name: 'README.md', exact: true }).click()
    await expect(editor).toHaveValue('# 未保存的文件草稿\n\n保持原样')
    await expect(editor).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await treeToggle.click()
    await page.keyboard.press('Escape')
    await expect(browser).toBeHidden()
    await expect(treeToggle).toBeFocused()
    await treeToggle.click()
    await panel.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(editor).toBeFocused()
    await expect(browser).toBeHidden()

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.5)
    )
    const back = panel.getByRole('button', { name: '返回对话', exact: true })
    await expect(back).toBeVisible()
    await expect(composer).toBeHidden()
    await expect
      .poll(() =>
        panel.evaluate(
          (el) => el.parentElement!.getBoundingClientRect().width - el.getBoundingClientRect().width
        )
      )
      .toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page.screenshot({ path: resolve(evidence, 'scaled-dark.png') })
    await back.click()
    await expect(page.getByRole('dialog', { name: '尚有未保存内容' })).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(editor).toHaveValue('# 未保存的文件草稿\n\n保持原样')
    await back.click()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(composer).toBeVisible()
    await expect(composer).toHaveText('返回对话后保留这条草稿')
    await page.screenshot({ path: resolve(evidence, 'scaled-conversation.png') })
  } finally {
    // A failed assertion may leave an unsaved test draft. Do not open an OS
    // beforeunload prompt while tearing down this isolated fixture window.
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await app.close()
  }
})
