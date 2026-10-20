import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

const folder = resolve('playwright-report/polish-revision')
async function capture(app: ElectronApplication, name: string): Promise<void> {
  const page = await app.firstWindow()
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getTiming().iterations === Infinity) continue
      try {
        animation.finish()
      } catch {
        /* A pending animation has no finish time yet. */
      }
    }
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))
    )
  })
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
  )
  await writeFile(resolve(folder, `${name}.png`), Buffer.from(png, 'base64'))
}

test('sidebar visibility, title editing and labelled chat information remain usable without decorative edge markers', async () => {
  test.setTimeout(90000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `profile-${Date.now()}`)
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
    await page.getByRole('button', { name: 'Experiments · exp', exact: true }).click()
    await page.locator('.session-entry[title*="claude-review"]').click()
    await expect(page.locator('.app-titlebar img, .task-sidebar img')).toHaveCount(0)
    const sidebar = page.locator('.task-sidebar')
    const selected = page.locator('.session-entry.selected')
    await expect(selected).toHaveCSS('box-shadow', 'none')
    const width = (await sidebar.boundingBox())!.width
    await page.locator('.sidebar-close').click()
    await expect(sidebar).toBeVisible()
    await expect(page.locator('.sidebar-expanded-content')).toBeHidden()
    await expect(page.locator('.sidebar-rail')).toBeVisible()
    await expect(page.locator('.sidebar-visibility-toggle')).toBeFocused()
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(64)
    await page.reload()
    await expect(sidebar).toBeVisible()
    await expect(page.locator('.sidebar-expanded-content')).toBeHidden()
    await expect(page.locator('.sidebar-rail')).toBeVisible()
    await page.locator('.sidebar-visibility-toggle').click()
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(width, 0)
    await expect(selected).toBeVisible()
    await page.locator('.sidebar-visibility-toggle').click()
    await page.keyboard.press('Control+k')
    await expect(page.locator('.sidebar-search input')).toBeFocused()
    await expect(sidebar).toBeVisible()
    await page.keyboard.press('Escape')

    // Both entry points use the same full-width, prefilled title field.
    await page.locator('.session-entry.selected + .session-row-actions > button').click()
    await page.getByRole('menuitem', { name: '修改标题', exact: true }).click()
    const dialog = page.locator('.title-edit-modal')
    const input = dialog.getByRole('textbox', { name: '会话标题', exact: true })
    await expect(input).toHaveValue('claude-review')
    await expect(input).toBeFocused()
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(40)
    expect((await input.boundingBox())!.width).toBeGreaterThan(300)
    await input.fill('成本模型复核')
    await capture(app, 'edit-title-light')
    await input.press('Enter')
    await expect(page.locator('.workspace-title h1')).toHaveText('成本模型复核')
    await page.locator('.session-menu > summary').click()
    const info = page.locator('.session-menu-context')
    for (const [label, value] of [
      ['服务器名称', 'EXP · Experiments'],
      ['SSH 配置别名', 'exp'],
      ['远端工作目录', '/srv/Experiments'],
      ['远端 tmux 会话名', 'claude-review']
    ] as const) {
      await expect(
        info
          .locator('dl > div')
          .filter({ has: page.getByText(label, { exact: true }) })
          .locator('dd')
      ).toHaveText(value!)
    }
    const dragRegions = await page
      .locator('.session-menu-content')
      .evaluate((element) =>
        [element, ...element.querySelectorAll('*')].map((node) =>
          getComputedStyle(node).getPropertyValue('-webkit-app-region')
        )
      )
    expect(dragRegions.every((region) => region === 'no-drag')).toBe(true)
    await expect(info).toHaveCSS('user-select', 'text')
    const before = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds()
    )
    const address = await info.locator('dd').filter({ hasText: '/srv/Experiments' }).boundingBox()
    await page.mouse.move(address!.x + 2, address!.y + address!.height / 2)
    await page.mouse.down()
    await page.mouse.move(address!.x + address!.width - 2, address!.y + address!.height / 2, {
      steps: 12
    })
    await page.mouse.up()
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
    ).toEqual(before)
    expect(await page.evaluate(() => getSelection()?.toString())).toContain('/srv/Experiments')
    await capture(app, 'chat-information-light')
    await page
      .locator('.session-menu-content')
      .getByRole('button', { name: '修改标题', exact: true })
      .click()
    await expect(input).toHaveValue('成本模型复核')
    await input.fill('')
    await dialog.getByRole('button', { name: '保存标题', exact: true }).click()
    await expect(page.locator('.workspace-title h1')).toHaveText('claude-review')

    await page.getByRole('button', { name: '设置', exact: true }).click()
    const settings = page.locator('.settings-modal')
    await settings.getByRole('button', { name: '外观', exact: true }).click()
    await settings.getByRole('button', { name: '紫色', exact: true }).click()
    const modified = settings.locator('.setting-row[data-modified="true"]')
    expect(await modified.count()).toBeGreaterThan(0)
    for (const row of await modified.all()) {
      expect(await row.evaluate((element) => getComputedStyle(element, '::before').content)).toBe(
        'none'
      )
    }
    expect(
      (await settings.locator('.settings-nav-button').first().boundingBox())!.height
    ).toBeGreaterThanOrEqual(38)
    expect(
      (await settings.getByLabel('界面字号', { exact: true }).boundingBox())!.height
    ).toBeGreaterThanOrEqual(36)
    await capture(app, 'settings-light')
    await settings.getByRole('button', { name: '深色', exact: true }).click()
    await capture(app, 'settings-dark')
    await page.keyboard.press('Escape')
    await page.locator('.session-menu > summary').click()
    await capture(app, 'chat-information-dark')
    await page
      .locator('.session-menu-content')
      .getByRole('button', { name: '修改标题', exact: true })
      .click()
    await capture(app, 'edit-title-dark')
    await page.keyboard.press('Escape')
    await expect(page.locator('.session-menu > summary')).toBeFocused()
    await page.locator('.sidebar-visibility-toggle').click()
    await expect(sidebar).toBeVisible()
    await expect(page.locator('.sidebar-expanded-content')).toBeHidden()
    await expect(page.locator('.sidebar-rail')).toBeVisible()
    await capture(app, 'sidebar-collapsed')
    await page.locator('.sidebar-visibility-toggle').click()
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(980, 680)
      win.webContents.setZoomFactor(1.5)
    })
    await page.locator('.session-menu > summary').click()
    const popup = page.locator('.session-menu-content')
    const bounds = (await popup.boundingBox())!
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y).toBeGreaterThanOrEqual(40)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    await capture(app, 'chat-information-compact')
    await popup.getByRole('button', { name: '修改标题', exact: true }).click()
    await expect(input).toBeVisible()
    await capture(app, 'edit-title-compact')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
