import { _electron as electron, expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { useOfflineSessionList } from './offline-shell'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const shellUserDataPath = resolve(projectRoot, 'test-results', 'user-data-app-shell')

test('boots the application shell and supports language, sidebar and terminal controls', async () => {
  test.setTimeout(90000)
  await rm(shellUserDataPath, { recursive: true, force: true })
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: shellUserDataPath }
  })

  try {
    const page = await electronApp.firstWindow()
    await useOfflineSessionList(electronApp)
    page.on('console', (message) => console.log(`[renderer:${message.type()}] ${message.text()}`))
    page.on('pageerror', (error) => console.log(`[renderer:error] ${error.message}`))
    await page.waitForLoadState('domcontentloaded')
    console.log(`[renderer:url] ${page.url()}`)
    await expect(page.locator('.task-sidebar').getByText('Conlaude', { exact: true })).toBeVisible()
    await expect(page.locator('.server-card')).toContainText('Example Server')
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await expect(page.locator('.new-session-button')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await page.getByRole('button', { name: '折叠侧边栏' }).click()
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
    await expect(page.locator('.sidebar-content')).toBeHidden()
    await expect(page.locator('.task-sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-rail')).toBeVisible()
    await expect(page.locator('.sidebar-visibility-toggle')).toBeVisible()
    await page.locator('.sidebar-visibility-toggle').click()
    await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/)
    await expect(page.locator('.sidebar-content')).toBeVisible()

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settingsDialog = page.locator('.settings-modal')
    await page.screenshot({ path: 'test-results/settings-light.png', fullPage: true })
    await expect(settingsDialog.getByRole('button', { name: '常规', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await settingsDialog.getByLabel('界面语言', { exact: true }).selectOption('en-US')
    await page.screenshot({ path: 'test-results/settings-english.png', fullPage: true })
    await settingsDialog
      .locator('.settings-footer')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await expect(page.locator('.new-session-button')).toContainText('New chat')
    await page.screenshot({ path: 'test-results/application-english.png', fullPage: true })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const englishSettingsDialog = page.locator('.settings-modal')
    await englishSettingsDialog
      .getByLabel('Interface language', { exact: true })
      .selectOption('zh-CN')
    await englishSettingsDialog
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()

    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: 'test-results/application-dark.png', fullPage: true })
    await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    const terminalPanel = page.locator('.terminal-drawer')
    await page.setViewportSize({ width: 1000, height: 700 })
    if (!(await terminalPanel.getAttribute('class'))?.includes('open')) {
      await page.getByRole('button', { name: '分屏', exact: true }).click()
    }
    const initialPanelBox = await terminalPanel.boundingBox()
    const sashBox = await page.locator('.terminal-sash').boundingBox()
    if (!initialPanelBox || !sashBox) throw new Error('Terminal panel geometry is unavailable')
    const dragDelta = initialPanelBox.height > 220 ? 60 : -60
    await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + sashBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(sashBox.x + sashBox.width / 2, sashBox.y + dragDelta, { steps: 5 })
    await page.mouse.up()
    await expect
      .poll(async () => Math.round((await terminalPanel.boundingBox())?.height ?? 0))
      .not.toBe(Math.round(initialPanelBox.height))
    const resizedPanelHeight = Math.round((await terminalPanel.boundingBox())?.height ?? 0)
    await page.getByTitle('最大化终端').click()
    await expect
      .poll(async () => Math.round((await terminalPanel.boundingBox())?.height ?? 0))
      .toBeGreaterThan(resizedPanelHeight)
    await page.getByTitle('恢复终端大小').click()
    await expect
      .poll(async () => Math.round((await terminalPanel.boundingBox())?.height ?? 0))
      .toBe(resizedPanelHeight)

    await page.screenshot({ path: 'test-results/application-shell.png', fullPage: true })
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1000, 700)
    })
    await expect(page.locator('.new-session-button')).toBeVisible()
    await expect(page.locator('.terminal-toolbar')).toBeVisible()
    const compactComposerBox = await page.locator('.composer-shell').boundingBox()
    const compactTerminalBox = await terminalPanel.boundingBox()
    if (!compactComposerBox || !compactTerminalBox)
      throw new Error('Compact layout geometry is unavailable')
    expect(compactComposerBox.y + compactComposerBox.height).toBeLessThanOrEqual(
      compactTerminalBox.y + 1
    )
    await page.screenshot({ path: 'test-results/application-minimum-window.png', fullPage: true })
  } finally {
    await electronApp.close()
  }
})
