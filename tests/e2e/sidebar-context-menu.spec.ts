import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { IPC } from '../../src/shared/ipc'
import { command, fixture } from './workspace-fixture'

const folder = resolve('playwright-report/sidebar-context-menu')

test('collapsed sidebar keeps the current chat status without losing drafts or saved width', async () => {
  test.setTimeout(60000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `rail-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await page.locator('.cm-content').fill('收起侧栏仍保留的草稿')
    await expect(page.locator('.brand .brand-logo')).toBeVisible()
    expect(
      await page
        .locator('.brand .brand-logo')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
    ).toBe(true)
    const sidebar = page.locator('.task-sidebar')
    const width = (await sidebar.boundingBox())!.width
    await command(app, {
      type: 'status',
      target: { profileId: 'mas', sessionName: 'claude-review' },
      status: { generating: true }
    })
    await page.locator('.sidebar-close').click()
    const rail = page.locator('.sidebar-rail')
    await expect(rail).toBeVisible()
    await expect(rail.locator('.brand-logo')).toBeVisible()
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(64)
    await expect(page.locator('.sidebar-expanded-content')).toBeHidden()
    await expect(page.locator('[aria-controls="workspace-sidebar"]')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await expect(rail.locator('.rail-server-button')).toHaveCount(0)
    await expect(rail.locator('.rail-chat-status')).toHaveCount(1)
    await expect(
      rail.getByRole('img', { name: 'claude-review · 正在生成', exact: true })
    ).toBeVisible()
    await page.screenshot({ path: resolve(folder, 'rail-light.png') })
    const logo = rail.getByRole('button', { name: '展开侧边栏', exact: true })
    const expandIcon = logo.locator('.sidebar-rail-expand-icon')
    await expect(expandIcon).toHaveCSS('opacity', '0')
    await logo.hover()
    await expect(expandIcon).toHaveCSS('opacity', '1')
    await expect(logo.locator('.brand-logo')).toHaveCSS('opacity', '0.15')
    await page.screenshot({ path: resolve(folder, 'rail-logo-hover.png') })
    await logo.click()
    await expect(rail).toHaveCount(0)
    await expect(page.locator('.sidebar-close')).toBeFocused()
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(width, 0)
    await expect(page.locator('.cm-content')).toHaveText('收起侧栏仍保留的草稿')
    await page.locator('.sidebar-close').click()
    await page.mouse.move(300, 100)
    await logo.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(logo).toBeFocused()
    await expect(expandIcon).toHaveCSS('opacity', '1')
    await logo.press('Enter')
    await expect(rail).toHaveCount(0)
    await expect(page.locator('.sidebar-close')).toBeFocused()
    await page.locator('.sidebar-close').click()
    await rail.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.locator('.settings-modal')
    await settings.getByRole('button', { name: '外观', exact: true }).click()
    await settings.getByRole('button', { name: '深色', exact: true }).click()
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(980, 680)
      win.webContents.setZoomFactor(1.5)
    })
    await page.screenshot({ path: resolve(folder, 'rail-dark-compact.png') })
    await expect(rail.getByRole('button', { name: '设置', exact: true })).toBeInViewport()
    await page.reload()
    await expect(rail).toBeVisible()
    await rail.getByRole('button', { name: '搜索项目或会话…', exact: true }).click()
    await expect(page.locator('.sidebar-search input')).toBeFocused()
    await expect(rail).toHaveCount(0)
    await expect(page.locator('[aria-controls="workspace-sidebar"]')).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(1440, 900)
      win.webContents.setZoomFactor(1)
    })
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(width, 0)
    await expect(page.locator('.cm-content')).toHaveText('收起侧栏仍保留的草稿')
    await page.locator('.sidebar-close').click()
    await logo.click()
    await expect(rail).toHaveCount(0)
    await expect(page.locator('.session-entry.selected')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('right-click and more-actions target the clicked chat without changing the current chat or draft', async () => {
  test.setTimeout(60000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `chats-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    const review = page.locator('.session-entry').filter({ hasText: 'claude-review' })
    const check = page.locator('.session-entry').filter({ hasText: 'claude-check' })
    await review.click()
    await page.locator('.cm-content').fill('当前会话的草稿不能丢失')
    const before = (await command(app, { type: 'calls' })) as { channel: string }[]
    await check.click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu).toHaveCount(1)
    await expect(menu.getByRole('menuitem')).toHaveText(['修改标题', '置顶会话', '删除会话…'])
    await expect(review).toHaveAttribute('aria-current', 'page')
    await page.screenshot({ path: resolve(folder, 'chat-menu-light.png') })
    await menu.getByRole('menuitem', { name: '置顶会话', exact: true }).click()
    await expect(check.getByLabel('已置顶')).toBeVisible()
    await check.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '修改标题', exact: true }).click()
    const input = page.getByRole('textbox', { name: '会话标题', exact: true })
    await expect(input).toHaveValue('claude-check')
    await input.fill('右键重命名的会话')
    await input.press('Enter')
    const renamed = page.locator('.session-entry').filter({ hasText: '右键重命名的会话' })
    await expect(renamed).toBeFocused()
    await expect(review).toHaveAttribute('aria-current', 'page')
    await renamed.locator('+ .session-row-actions > button').click()
    await expect(menu.getByRole('menuitem')).toHaveText(['修改标题', '取消置顶', '删除会话…'])
    await menu.getByRole('menuitem', { name: '取消置顶' }).click()
    await expect(renamed.getByLabel('已置顶')).toHaveCount(0)

    await renamed.focus()
    await page.keyboard.press('Shift+F10')
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(menu.getByRole('menuitem').last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(menu.getByRole('menuitem').last()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(renamed).toBeFocused()
    const after = (await command(app, { type: 'calls' })) as { channel: string }[]
    expect(after.filter((call) => call.channel === IPC.sessionsAttach)).toHaveLength(
      before.filter((call) => call.channel === IPC.sessionsAttach).length
    )
    await expect(page.locator('.cm-content')).toHaveText('当前会话的草稿不能丢失')

    await renamed.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '删除会话…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('claude-check')
    await expect(dialog.getByRole('button', { name: '终止远端会话', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '取消' }).click()
    await expect(renamed).toBeVisible()
    await renamed.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '删除会话…' }).click()
    await dialog.getByRole('textbox').fill('claude-check')
    await command(app, { type: 'terminate-error' })
    await dialog.getByRole('button', { name: '终止远端会话', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('server unavailable')
    await expect(renamed).toBeVisible()
    await command(app, { type: 'terminate-ok' })
    await dialog.getByRole('button', { name: '终止远端会话', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(renamed).toHaveCount(0)
    await expect(review).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.cm-content')).toHaveText('当前会话的草稿不能丢失')
    const calls = (await command(app, { type: 'calls' })) as { channel: string; request: unknown }[]
    expect(
      calls.filter((call) => call.channel === IPC.sessionsTerminate).map((call) => call.request)
    ).toEqual([
      { profileId: 'mas', sessionName: 'claude-check' },
      { profileId: 'mas', sessionName: 'claude-check' }
    ])
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('server and folder menus support contextual actions, dismissal and viewport edges', async () => {
  test.setTimeout(60000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `servers-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    const server = page.getByRole('button', { name: 'Experiments · exp', exact: true })
    await server.click()
    const project = page.locator('.project-heading').filter({ hasText: 'Experiments' })
    const menu = page.getByRole('menu')
    await project.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '复制路径' }).click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('/srv/Experiments')
    await project.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '收起文件夹' }).click()
    await expect(project).toHaveAttribute('aria-expanded', 'false')
    await project.locator('+ .session-row-actions > button').click()
    await menu.getByRole('menuitem', { name: '展开文件夹' }).click()
    await expect(project).toHaveAttribute('aria-expanded', 'true')
    await project.click({ button: 'right' })
    await server.click({ button: 'right' })
    await expect(menu).toHaveCount(1)
    await expect(menu).toHaveAccessibleName('服务器操作 · EXP · Experiments')
    await menu.getByRole('menuitem', { name: '编辑服务器' }).click()
    const settings = page.locator('.settings-modal')
    await expect(settings.locator('.settings-embedded')).toBeVisible()
    const name = settings.getByLabel('服务器名称', { exact: true })
    await expect(name).toHaveValue('EXP · Experiments')
    await name.fill('实验服务器')
    await settings.getByRole('button', { name: '保存服务器', exact: true }).click()
    await settings
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    await expect(server).toContainText('实验服务器')
    await server.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '收起服务器' }).click()
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await server.locator('+ .session-row-actions > button[aria-haspopup="menu"]').click()
    await page.keyboard.press('Tab')
    await expect(menu).toHaveCount(0)
    await server.click({ button: 'right' })
    await page.locator('.brand strong').click()
    await expect(menu).toHaveCount(0)

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await settings.getByRole('button', { name: '外观', exact: true }).click()
    await settings.getByRole('button', { name: '深色', exact: true }).click()
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(980, 680)
      win.webContents.setZoomFactor(1.5)
    })
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await server.dispatchEvent('contextmenu', {
      clientX: viewport.width - 2,
      clientY: viewport.height - 2
    })
    const bounds = (await menu.boundingBox())!
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7)
    await page.screenshot({ path: resolve(folder, 'server-menu-dark-compact.png') })
    await page.locator('.project-list').dispatchEvent('wheel')
    await expect(menu).toHaveCount(0)
    await server.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '删除服务器', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('实验服务器')
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
    await expect(server).toBeVisible()
    await server.click({ button: 'right' })
    await menu.getByRole('menuitem', { name: '删除服务器', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除服务器', exact: true }).click()
    await expect(server).toHaveCount(0)
    const saved = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(saved.profiles.map((profile) => profile.id)).toEqual(['mas'])
    const calls = (await command(app, { type: 'calls' })) as { channel: string; request: unknown }[]
    expect(
      calls.filter((call) => call.channel === IPC.profilesRemove).map((call) => call.request)
    ).toEqual(['exp'])
    expect(calls.filter((call) => call.channel === IPC.sessionsTerminate)).toEqual([])
  } finally {
    await app.close()
  }
})
