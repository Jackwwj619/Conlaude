import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

test('compact navigation and appearance preferences remain usable across window sizes', async () => {
  test.setTimeout(120000)
  const folder = resolve('playwright-report/compact-appearance')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `data-${Date.now()}`)
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
    await page.locator('.session-entry[title*="claude-review"]').click()
    for (const selector of ['.sidebar-server', '.project-heading', '.session-entry']) {
      expect((await page.locator(selector).first().boundingBox())!.height).toBeLessThanOrEqual(32)
    }
    expect(
      (await page.locator('.sidebar-footer-button').first().boundingBox())!.height
    ).toBeGreaterThanOrEqual(36)
    await expect(page.locator('.sidebar-server-copy small')).toHaveCount(0)
    await expect(page.locator('.project-heading').first().locator('svg')).toHaveCount(1)
    await page.locator('.session-menu > summary').click()
    await page.getByRole('button', { name: '修改标题', exact: true }).click()
    await page
      .locator('.small-modal input')
      .fill('检查回测结果与交易成本 · 一个需要保持可读的长对话标题')
    await page.locator('.small-modal button[type="submit"]').click()
    const measurements: unknown[] = []
    for (const [width, height, zoom] of [
      [1440, 920, 1],
      [980, 680, 1],
      [980, 680, 1.25],
      [980, 680, 1.5]
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows()[0]!
          win.setSize(size.width!, size.height!)
          win.webContents.setZoomFactor(size.zoom!)
        },
        { width, height, zoom }
      )
      await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(width! / zoom!, -1)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      )
      await expect(page.locator('.workspace-title h1')).toBeVisible()
      if (width! / zoom! < 740) await expect(page.locator('.workspace-endpoint')).toBeHidden()
      const geometry = await page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect()
          return { x: r.x, right: r.right, width: r.width }
        }
        return {
          title: box('.workspace-title h1'),
          actions: box('.header-actions'),
          header: box('.workspace-header'),
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth
        }
      })
      expect(geometry.title.width).toBeGreaterThanOrEqual(24)
      expect(geometry.title.right).toBeLessThanOrEqual(geometry.actions.x)
      expect(geometry.actions.right).toBeLessThanOrEqual(geometry.viewport - 140)
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport)
      measurements.push({ width, height, zoom, ...geometry })
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
          .toPNG()
          .toString('base64')
      )
      await writeFile(resolve(folder, `workspace-${width}-${zoom}.png`), Buffer.from(png, 'base64'))
    }
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(1440, 920)
      win.webContents.setZoomFactor(1)
    })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.locator('.settings-modal')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.getByRole('button', { name: '舒适', exact: true }).click()
    await expect
      .poll(async () => (await page.locator('.sidebar-server').first().boundingBox())!.height)
      .toBeGreaterThan(32)
    await dialog.getByRole('button', { name: '紫色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
    await dialog.getByRole('button', { name: '侧栏与顶部', exact: true }).click()
    await dialog.getByLabel('侧栏显示服务器地址', { exact: true }).check()
    await expect(page.locator('.sidebar-server-copy small')).toHaveCount(2)
    await dialog.getByLabel('侧栏显示会话数量', { exact: true }).uncheck()
    await expect(page.locator('.sidebar-server-count')).toHaveCount(0)
    await dialog.getByLabel('顶部服务器信息', { exact: true }).selectOption('hidden')
    await expect(page.locator('.workspace-endpoint')).toHaveCount(0)
    await dialog.getByLabel('顶部显示连接状态', { exact: true }).uncheck()
    await expect(page.locator('.workspace-context')).toHaveCount(0)
    await dialog.getByRole('button', { name: '恢复本页默认值', exact: true }).click()
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    await dialog.locator('.settings-advanced summary').click()
    await dialog.getByLabel('控件圆角', { exact: true }).fill('0')
    await dialog.getByLabel('控件圆角', { exact: true }).press('Tab')
    await expect(page.locator('.sidebar-server').first()).toHaveCSS('border-radius', '0px')
    await dialog.getByLabel('界面动画', { exact: true }).selectOption('reduced')
    await expect(page.locator('.project-sessions').first()).toHaveCSS(
      'transition-duration',
      '1e-05s'
    )
    await dialog.getByRole('button', { name: '紧凑', exact: true }).click()
    await dialog.getByRole('button', { name: '恢复默认值：主题色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue')
    await dialog.getByRole('button', { name: '恢复本页默认值', exact: true }).click()
    await expect(page.locator('.sidebar-server').first()).toHaveCSS('border-radius', '6px')
    await expect(page.locator('.sidebar-server-count')).toHaveCount(2)
    await expect(page.locator('.workspace-endpoint')).toHaveCount(1)
    await expect(dialog.locator('.settings-footer [role="status"]')).toHaveText('已保存')
    await dialog.getByRole('group', { name: '主题', exact: true }).scrollIntoViewIfNeeded()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    const light = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
    )
    await writeFile(resolve(folder, 'settings-light.png'), Buffer.from(light, 'base64'))
    await dialog.getByRole('button', { name: '深色', exact: true }).click()
    await expect(dialog.locator('.settings-footer [role="status"]')).toHaveText('已保存')
    await dialog.getByRole('group', { name: '主题', exact: true }).scrollIntoViewIfNeeded()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
    )
    await writeFile(resolve(folder, 'settings-dark.png'), Buffer.from(png, 'base64'))
    await writeFile(resolve(folder, 'measurements.json'), JSON.stringify(measurements, null, 2))
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
