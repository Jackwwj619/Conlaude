import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { command, fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

const folder = resolve('playwright-report/ux-revision')
const target = { profileId: 'mas', sessionName: 'claude-review' }
async function launch(): Promise<ElectronApplication> {
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `profile-${Date.now()}`)
    }
  })
  await fixture(app)
  await app.evaluate(({ ipcMain }, channels) => {
    ipcMain.removeHandler(channels.profilesGetSshConfig)
    ipcMain.handle(channels.profilesGetSshConfig, () => ({
      path: 'C:/fixture/config',
      content: 'Host demo\n  HostName example.test',
      entries: []
    }))
    ipcMain.removeHandler(channels.appListFonts)
    ipcMain.handle(channels.appListFonts, () => ['Consolas', 'JetBrains Mono'])
  }, IPC)
  await app.evaluate(() =>
    (
      globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
    ).resumeOfflineRenderer()
  )
  return app
}
async function capture(app: ElectronApplication, name: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
  )
  await writeFile(resolve(folder, `${name}.png`), Buffer.from(png, 'base64'))
}

test('folders, auto-growing composer and delivery states behave across sessions', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry[title*="claude-review"]').click()
    const row = page.getByRole('button', { name: 'project', exact: true })
    const selected = page.locator('.session-entry.selected')
    await expect(row.locator('.lucide-folder-open')).toHaveCount(1)
    await expect(row.locator('svg')).toHaveCount(1)
    await row.click({ position: { x: 140, y: 17 } })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(selected).toBeHidden()
    await expect(row.locator('.lucide-folder')).toHaveCount(1)
    await row.press('ArrowRight')
    await expect(selected).toBeVisible()
    const editor = page.locator('.cm-content')
    const shell = page.locator('.composer-shell')
    const compact = (await shell.boundingBox())!.height
    expect(compact).toBeLessThan(86)
    await editor.fill('first\nsecond\nthird\nfourth')
    await expect.poll(async () => (await shell.boundingBox())!.height).toBeGreaterThan(compact + 45)
    await editor.fill('send this')
    await expect.poll(async () => (await shell.boundingBox())!.height).toBeLessThan(86)
    await page.locator('.send-button').click()
    await expect(page.locator('.composer-state')).toContainText('发送中')
    await command(app, { type: 'send-done' })
    await expect(page.locator('.composer-state')).toContainText('已发送')
    await command(app, { type: 'status', target, status: { generating: true } })
    await expect(page.locator('.composer-state')).toContainText('正在生成')
    await capture(app, 'workspace-generating')
    await page.locator('.session-entry').filter({ hasText: 'claude-check' }).click()
    await expect(page.locator('.composer-state')).toContainText('可以发送')
    await page.locator('.session-entry[title*="claude-review"]').click()
    await command(app, { type: 'status', target, status: { generating: false } })
    await expect(page.locator('.composer-state')).toContainText('已发送')
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'delivery-final',
        kind: 'assistant',
        isFinal: true,
        text: '发送与生成回归完成。'
      }
    })
    await expect(page.locator('.composer-state')).toContainText('生成已结束')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setSize(980, 680)
      window.webContents.setZoomFactor(1.25)
    })
    await editor.fill('line\n'.repeat(60))
    const button = await page.locator('.send-button').boundingBox()
    expect(button!.y + button!.height).toBeLessThan(await page.evaluate(() => innerHeight))
    await capture(app, 'workspace-compact')
  } finally {
    await app.close()
  }
})

test('settings keep editors inside the shell and code typography independent', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.locator('.settings-modal')
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished))
    })
    const bounds = await dialog.boundingBox()
    const openProfile = dialog.getByRole('button', { name: '编辑服务器与会话默认值' })
    await dialog.getByRole('button', { name: '服务器', exact: true }).click()
    await openProfile.click()
    await expect(dialog.locator('.settings-nav')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    expect(await dialog.boundingBox()).toEqual(bounds)
    const name = dialog.locator('.profile-editor input').first()
    await name.fill('Unsaved server name')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await expect(dialog).toContainText('尚有未保存内容')
    await dialog.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(name).toHaveValue('Unsaved server name')
    await capture(app, 'settings-server')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '外观', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(
      dialog.locator('.settings-nav').getByRole('button', { name: '终端', exact: true })
    ).toHaveCount(0)
    await dialog.getByLabel('代码字体', { exact: true }).fill('Consolas')
    await dialog.locator('[role="option"][data-value="local:Consolas"]').click()
    await dialog.getByLabel('代码字号', { exact: true }).fill('18')
    await dialog.getByLabel('代码字号', { exact: true }).press('Tab')
    await dialog.getByLabel('代码行距', { exact: true }).fill('1.8')
    await dialog.getByLabel('代码行距', { exact: true }).press('Tab')
    await expect(dialog.locator('.settings-footer')).toContainText('已保存')
    const saved = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(saved.code).toMatchObject({ fontSize: 18, lineHeight: 1.8 })
    expect(saved.code.font.toLowerCase()).toContain('consolas')
    expect(saved.terminal.fontSize).toBe(14)
    expect(saved.conversation.fontSize).toBe(14)
    await dialog.getByLabel('代码字号', { exact: true }).scrollIntoViewIfNeeded()
    await capture(app, 'settings-appearance')
    await dialog.getByRole('button', { name: '服务器', exact: true }).click()
    await dialog.getByRole('button', { name: '编辑 ~/.ssh/config', exact: true }).click()
    await expect(dialog.locator('textarea')).toHaveValue('Host demo\n  HostName example.test')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await capture(app, 'settings-ssh')
    await page.keyboard.press('Escape')
    await expect(
      dialog.getByRole('button', { name: '编辑 ~/.ssh/config', exact: true })
    ).toBeFocused()
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '深色', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setSize(980, 680)
      window.webContents.setZoomFactor(1.25)
    })
    await capture(app, 'settings-dark-compact')
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    )
    await page.keyboard.press('Escape')
    await page.reload()
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).code).toEqual(saved.code)
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry[title*="claude-review"]').click()
    await command(app, {
      type: 'event',
      target,
      event: { id: 'code-preferences', kind: 'assistant', text: '```ts\nconst answer = 42\n```' }
    })
    await expect(page.locator('.code-block pre')).toHaveCSS('font-size', '18px')
    await expect(page.locator('.code-block pre')).toHaveCSS('line-height', '32.4px')
    expect(
      await page
        .locator('.code-block pre')
        .evaluate((element) => getComputedStyle(element).fontFamily)
    ).toContain('Consolas')
  } finally {
    await app.close()
  }
})
