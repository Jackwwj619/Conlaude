import { _electron as electron, expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { useOfflineSessionList } from './offline-shell'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const userDataPath = resolve(projectRoot, 'test-results', 'user-data-settings-preferences')

test('uses Shift+Enter for newlines with the Enter send shortcut', async () => {
  test.setTimeout(60000)
  await rm(userDataPath, { recursive: true, force: true })
  const electronApp = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userDataPath }
  })

  try {
    const page = await electronApp.firstWindow()
    await useOfflineSessionList(electronApp)
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.locator('.settings-modal')

    await settings.getByRole('button', { name: '输入与发送', exact: true }).click()
    await settings.getByLabel('发送快捷键', { exact: true }).selectOption('Enter')
    await settings
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()

    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    const composer = page.locator('.cm-content')
    await composer.click()
    await page.keyboard.insertText('first line')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.insertText('second line')
    await expect(composer.locator('.cm-line')).toHaveCount(2)
    await page.keyboard.press('Enter')
    await expect(composer.locator('.cm-line')).toHaveCount(2)
  } finally {
    await electronApp.close()
  }
})

test('searches settings, applies preferences, and retains them after restart', async () => {
  test.setTimeout(90000)
  const expandedDataPath = resolve(projectRoot, 'test-results', 'user-data-settings-expanded')
  await rm(expandedDataPath, { recursive: true, force: true })
  const launch = () =>
    electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: expandedDataPath }
    })
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await useOfflineSessionList(app)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.locator('.settings-modal')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '舒适', exact: true }).click()
    await dialog.getByRole('button', { name: '青绿', exact: true }).click()
    await dialog.getByRole('button', { name: '侧栏与顶部', exact: true }).click()
    await dialog.getByLabel('侧栏字号', { exact: true }).fill('14')
    await dialog.getByLabel('侧栏字号', { exact: true }).press('Tab')
    await dialog.getByLabel('侧栏显示服务器地址', { exact: true }).check()
    await dialog.getByLabel('顶部服务器信息', { exact: true }).selectOption('label')
    await page.screenshot({ path: 'test-results/settings-expanded-light.png' })
    await dialog.getByRole('searchbox', { name: '搜索设置' }).fill('字号')
    for (const [label, value] of [
      ['回复字号', '20'],
      ['代码字号', '18'],
      ['终端字号', '18'],
      ['输入框字号', '17']
    ]) {
      await dialog
        .locator('.settings-search-results')
        .getByRole('button', { name: new RegExp(label!) })
        .click()
      await dialog.getByLabel(label!, { exact: true }).fill(value!)
      await dialog.getByLabel(label!, { exact: true }).press('Tab')
    }
    await dialog.getByRole('button', { name: '清除搜索' }).click()
    await dialog.getByRole('button', { name: '输入与发送', exact: true }).click()
    await dialog.locator('.settings-advanced summary').click()
    await dialog.getByLabel('单条消息字符上限', { exact: true }).fill('5000')
    await dialog.getByLabel('单条消息字符上限', { exact: true }).press('Tab')
    await page.evaluate(() => {
      localStorage.setItem('clb:history:mas:sample', JSON.stringify(['one', 'two', 'three']))
      localStorage.setItem('clb:draft:mas:sample', 'keep this draft')
    })
    await dialog.getByLabel('每个会话保留的输入历史条数', { exact: true }).fill('2')
    await dialog.getByLabel('每个会话保留的输入历史条数', { exact: true }).press('Tab')
    await dialog.getByRole('button', { name: '应用并清理' }).click()
    await dialog.getByLabel('浏览输入历史', { exact: true }).selectOption('alt-arrows')
    await dialog.getByLabel('输入框自动折行', { exact: true }).uncheck()
    await dialog.getByRole('button', { name: '对话', exact: true }).click()
    await dialog.getByLabel('显示消息时间', { exact: true }).uncheck()
    await dialog.getByLabel('默认展开执行详情', { exact: true }).check()
    await dialog.getByLabel('跟随最新消息', { exact: true }).check()
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByLabel('光标形状', { exact: true }).selectOption('bar')
    await dialog.getByLabel('光标闪烁', { exact: true }).uncheck()
    await dialog.getByLabel('终端行距', { exact: true }).fill('1.2')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '深色', exact: true }).click()
    await dialog
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '17px')
    await expect(page.locator('.cm-content')).not.toHaveClass(/cm-lineWrapping/)
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('clb:history:mas:sample')!))
    ).toEqual(['one', 'two'])
    expect(await page.evaluate(() => localStorage.getItem('clb:draft:mas:sample'))).toBe(
      'keep this draft'
    )
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('button', { name: '输入与发送', exact: true }).click()
    await page.screenshot({ path: 'test-results/settings-expanded-dark.png' })
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setMinimumSize(500, 500)
      window.setSize(680, 720)
    })
    await expect(
      dialog.locator('.settings-footer').getByRole('button', { name: '关闭', exact: true })
    ).toBeVisible()
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700)
    await page.screenshot({ path: 'test-results/settings-expanded-narrow.png' })
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true
    )
  } finally {
    await app.close()
  }
  const reopened = await launch()
  try {
    const page = await reopened.firstWindow()
    await useOfflineSessionList(reopened)
    const saved = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(saved).toMatchObject({
      schemaVersion: 10,
      theme: 'dark',
      appearance: {
        density: 'comfortable',
        accent: 'teal',
        sidebarFontSize: 14,
        showServerAddress: true,
        headerServer: 'label'
      },
      code: { font: 'jetbrains-mono', fontSize: 18, lineHeight: 1.65 },
      terminal: { fontSize: 18, cursorStyle: 'bar', cursorBlink: false, lineHeight: 1.2 },
      composer: {
        fontSize: 17,
        historyLimit: 2,
        maxCharacters: 5000,
        historyNavigation: 'alt-arrows',
        lineWrapping: false
      },
      conversation: { fontSize: 20, showTimestamps: false, expandActivity: true, autoScroll: true }
    })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await expect(page.getByLabel('显示消息时间', { exact: true })).not.toBeChecked()
    await expect(page.getByLabel('默认展开执行详情', { exact: true })).toBeChecked()
  } finally {
    await reopened.close()
  }
})
