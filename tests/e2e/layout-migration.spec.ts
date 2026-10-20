import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

test('sidebar and split sizing, grouping and local session actions persist', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `layout-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 920))
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const sidebar = page.getByRole('separator', { name: '调整侧栏宽度' })
    await sidebar.focus()
    await sidebar.press('ArrowRight')
    await expect(sidebar).toHaveAttribute('aria-valuenow', '268')
    await page.getByRole('button', { name: 'project', exact: true }).click()
    await expect(page.locator('.session-entry').filter({ hasText: 'claude-review' })).toBeHidden()
    await page.reload()
    await expect(sidebar).toHaveAttribute('aria-valuenow', '268')
    await expect(page.getByRole('button', { name: 'project', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await page.getByRole('button', { name: 'project', exact: true }).click()
    await page.getByRole('button', { name: '会话操作 · claude-check', exact: true }).click()
    await page.getByRole('menuitem', { name: '修改标题' }).click()
    await page.getByRole('textbox', { name: '会话标题' }).fill('Local sidebar title')
    await page.getByRole('button', { name: '保存标题', exact: true }).click()
    await page.getByRole('button', { name: '会话操作 · Local sidebar title', exact: true }).click()
    await page.getByRole('menuitem', { name: '置顶会话' }).click()
    await expect(page.locator('.session-entry').first()).toContainText('Local sidebar title')
    await page.getByRole('button', { name: '分屏', exact: true }).click()
    const split = page.locator('.terminal-sash')
    await expect(split).toHaveAttribute('aria-orientation', 'vertical')
    await split.focus()
    await split.press('ArrowLeft')
    await expect(split).toHaveAttribute('aria-valuenow', '49')
    await page.locator('.cm-content').fill('A long draft line\n'.repeat(80))
    const send = await page.locator('.send-button').boundingBox()
    expect(send!.y + send!.height).toBeLessThan(920)
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(980, 680)
      win.webContents.setZoomFactor(1.5)
    })
    await expect(split).toHaveAttribute('aria-orientation', 'horizontal')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rect = document.querySelector('.send-button')!.getBoundingClientRect()
          return rect.bottom <= innerHeight && rect.right <= innerWidth
        })
      )
      .toBe(true)
  } finally {
    await app.close()
  }
})

test('Alt menus, narrow overflow and conversation commands retain editor focus', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `menus-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const editor = page.locator('.cm-content')
    await editor.fill('Retain local input')
    await editor.press('Alt+v')
    await expect(page.getByRole('menu', { name: '视图' })).toBeVisible()
    await page.getByRole('menuitem', { name: '搜索当前对话' }).click()
    await expect(page.getByRole('searchbox', { name: '搜索当前对话' })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Alt+e')
    await page.getByRole('menuitem', { name: '聚焦输入框' }).click()
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText('Retain local input')
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(980, 680)
      win.webContents.setZoomFactor(1.5)
    })
    await expect(page.locator('.app-menu-trigger').filter({ hasText: '更多' })).toBeVisible()
    await page.keyboard.press('Alt+s')
    await page.getByRole('menuitem', { name: '修改标题' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('textbox', { name: '会话标题' }).fill('A longer local title')
    await page.getByRole('button', { name: '保存标题' }).click()
    await expect(
      page.locator('.session-entry').filter({ hasText: 'A longer local title' })
    ).toBeVisible()
  } finally {
    await app.close()
  }
})
