import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('panels share right tabs, preserve edits, and dock terminal below the conversation', async () => {
  test.setTimeout(90000)
  const evidence = resolve('playwright-report/panel-docking')
  await mkdir(evidence, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_TEST_HIDDEN: '1',
      CLB_USER_DATA_DIR: resolve(`test-results/panel-dock-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      let content = '# Editable file\n\nHello'
      ipcMain.removeHandler(channels.filesList)
      ipcMain.handle(channels.filesList, (_event, request) => ({
        path: request.path,
        parent: '/',
        truncated: false,
        entries: [
          {
            name: 'notes.md',
            path: request.path + '/notes.md',
            kind: 'file',
            size: 30,
            modified: Date.now()
          }
        ]
      }))
      ipcMain.removeHandler(channels.filesRead)
      ipcMain.handle(channels.filesRead, (_event, request) => ({
        path: request.path,
        content,
        version: 'a'.repeat(64),
        writable: true,
        lineEnding: 'LF'
      }))
      ipcMain.removeHandler(channels.filesSave)
      ipcMain.handle(channels.filesSave, (_event, request) => {
        content = request.content
        return { ...request, writable: true, lineEnding: 'LF', version: 'b'.repeat(64) }
      })
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Experiments · exp', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const rightToggle = page.getByRole('button', { name: '右侧栏', exact: true })
    const bottomToggle = page.getByRole('button', { name: '底部栏', exact: true })
    expect((await bottomToggle.boundingBox())!.y).toBe((await rightToggle.boundingBox())!.y)
    expect(
      (await rightToggle.boundingBox())!.x - (await bottomToggle.boundingBox())!.x
    ).toBeLessThan(45)
    const assertStatusBottom = async () => {
      const bounds = (await page.locator('.status-bar').boundingBox())!
      expect(bounds.y + bounds.height).toBeCloseTo(await page.evaluate(() => innerHeight), 0)
    }
    await assertStatusBottom()
    const controls = page.locator('.app-titlebar .sidebar-visibility-toggle')
    await expect(controls).toHaveCount(3)
    for (const control of await controls.all()) {
      await expect(control).toHaveCSS('box-shadow', 'none')
      expect(await control.locator('svg').getAttribute('viewBox')).toBe('0 0 24 24')
    }
    expect((await rightToggle.boundingBox())!.x).toBeGreaterThan(
      (await bottomToggle.boundingBox())!.x
    )
    await page.getByRole('button', { name: '右侧栏', exact: true }).click()
    const terminal = page.locator('.terminal-drawer')
    const terminalHost = await page.locator('.xterm-host').elementHandle()
    await expect(terminal).toBeVisible()
    expect(
      (await terminal.locator('.control-toggle svg').boundingBox())!.width
    ).toBeGreaterThanOrEqual(16)
    await expect(terminal.locator('.control-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(terminal.locator('.lucide-mouse')).toBeVisible()
    await expect(terminal.getByRole('button', { name: /移到|搜索/ })).toHaveCount(0)
    await terminal.locator('.xterm-helper-textarea').press('Control+f')
    await expect(terminal.locator('.terminal-search-input')).toBeFocused()
    await terminal.locator('.terminal-search-input').fill('Ready')
    await terminal.locator('.terminal-search-input').press('Escape')
    await expect(terminal.locator('.terminal-search-input')).toHaveCount(0)
    const chat = page.locator('.conversation-area')
    const rightBounds = await page.locator('.panel-dock').boundingBox()
    expect((await terminal.boundingBox())!.x).toBeGreaterThanOrEqual(
      (await chat.boundingBox())!.x + (await chat.boundingBox())!.width - 1
    )
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    const files = page.locator('#remote-files-panel')
    await expect(files.locator('.remote-directory-browser')).toBeVisible()
    expect((await page.locator('.panel-dock').boundingBox())!.width).toBe(rightBounds!.width)
    await files.getByRole('button', { name: 'notes.md', exact: true }).click()
    await expect(files.getByRole('button', { name: '目录侧栏' })).toBeVisible()
    const tabsBounds = (await files.locator('.dock-tabs').boundingBox())!
    const tabBounds = (await files.locator('.panel-dock-header').boundingBox())!
    expect(tabsBounds.y).toBeGreaterThanOrEqual(tabBounds.y)
    expect(tabsBounds.y + tabsBounds.height).toBeLessThanOrEqual(tabBounds.y + tabBounds.height)
    await expect(files.locator('.panel-dock-header')).toHaveCount(1)
    await expect(files.getByRole('button', { name: '目录侧栏' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    await expect(files.locator('.remote-directory-browser')).toBeHidden()
    await files.getByRole('button', { name: '编辑', exact: true }).click()
    const editor = files.getByRole('textbox', { name: '文件内容' })
    await editor.fill('# Edited\n\nKeep this draft')
    const dockBeforeMaximize = (await page.locator('.panel-dock').boundingBox())!
    await page.getByRole('button', { name: '全屏右侧栏', exact: true }).click()
    await expect(page.locator('.dock-layout')).toHaveAttribute('data-maximized', 'right')
    expect((await page.locator('.dock-layout').boundingBox())!.width).toBeCloseTo(
      await page.evaluate(() => innerWidth),
      0
    )
    await assertStatusBottom()
    await expect(editor).toHaveValue('# Edited\n\nKeep this draft')
    await page.getByRole('button', { name: '还原右侧栏', exact: true }).click()
    expect((await page.locator('.panel-dock').boundingBox())!.width).toBe(dockBeforeMaximize.width)

    await page.getByRole('button', { name: '关闭右侧栏' }).click()
    await expect(files).toBeHidden()
    await rightToggle.click()
    await expect(editor).toHaveValue('# Edited\n\nKeep this draft')
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    await expect(files).toBeHidden()
    await rightToggle.click()
    await expect(editor).toHaveValue('# Edited\n\nKeep this draft')
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '终端', exact: true })
      .click()
    await expect(files).toBeHidden()
    await expect(terminal).toBeVisible()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '终端', exact: true })
      .click()
    await expect(terminal).toBeHidden()
    await rightToggle.click()
    await expect(terminal).toBeVisible()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    await expect(editor).toHaveValue('# Edited\n\nKeep this draft')
    await editor.press('Control+s')
    await expect(files.getByText('已保存')).toBeVisible()
    await files.getByRole('button', { name: '预览', exact: true }).click()
    await expect(files.getByRole('heading', { name: 'Edited', exact: true })).toBeVisible()
    await files.getByRole('button', { name: '目录侧栏' }).click()
    await expect(files.locator('.remote-directory-browser')).toBeVisible()
    await expect(files.getByRole('heading', { name: 'Edited', exact: true })).toBeVisible()
    expect((await files.locator('.remote-directory-browser').boundingBox())!.width).toBeLessThan(
      (await files.boundingBox())!.width
    )
    await page.screenshot({ path: resolve(evidence, 'files.png') })
    await files.getByRole('button', { name: '目录侧栏' }).click()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '终端', exact: true })
      .click()
    await page.screenshot({ path: resolve(evidence, 'right.png') })
    await bottomToggle.click()
    await expect(page.locator('.dock-bottom')).toBeVisible()
    await expect(bottomToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#files-panel-tab')).toHaveAttribute('aria-selected', 'true')
    expect((await terminal.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await chat.boundingBox())!.y + (await chat.boundingBox())!.height - 1
    )
    await expect(files).toBeVisible()
    await assertStatusBottom()
    expect(
      (await terminal.boundingBox())!.y + (await terminal.boundingBox())!.height
    ).toBeLessThanOrEqual((await page.locator('.status-bar').boundingBox())!.y + 1)
    await expect(page.locator('.xterm-host')).toHaveCount(1)
    await page.getByRole('button', { name: '全屏底部栏', exact: true }).click()
    await expect(page.locator('.dock-layout')).toHaveAttribute('data-maximized', 'bottom')
    await expect(files).toBeHidden()
    await assertStatusBottom()
    expect((await terminal.boundingBox())!.width).toBeCloseTo(
      await page.evaluate(() => innerWidth),
      0
    )
    await page.getByRole('button', { name: '还原底部栏', exact: true }).click()
    await expect(files).toBeVisible()

    expect(
      await page
        .locator('.xterm-host')
        .evaluate((element, original) => element === original, terminalHost)
    ).toBe(true)
    await files.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished))
    )
    const oldHeight = (await terminal.boundingBox())!.height
    await terminal.getByRole('separator').press('ArrowUp')
    await expect.poll(async () => (await terminal.boundingBox())!.height).toBeGreaterThan(oldHeight)
    await page.screenshot({ path: resolve(evidence, 'bottom.png') })
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page.screenshot({ path: resolve(evidence, 'bottom-dark.png') })
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '终端', exact: true })
      .click()
    await expect(files).toBeHidden()
    await command(app, {
      type: 'status',
      target: { profileId: 'exp', sessionName: 'claude-review' },
      status: { readOnly: true }
    })
    await expect(terminal.locator('.control-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect(terminal.locator('.control-toggle')).toBeDisabled()
    await page.getByRole('button', { name: '关闭右侧栏' }).click()
    await expect(terminal).toBeHidden()
    await expect(files).toBeHidden()
    await page.getByRole('button', { name: '右侧栏', exact: true }).click()
    await expect(terminal).toBeVisible()
    await bottomToggle.click()
    await expect(page.locator('.dock-bottom')).toBeVisible()
    await bottomToggle.click()
    await expect(terminal).toBeHidden()
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy()
      })
      .catch(() => undefined)
    await app.close()
  }
})
