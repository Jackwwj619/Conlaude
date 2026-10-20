import { chromium, expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

let server: ViteDevServer
let url: string
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: resolve('.'),
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [resolve('.'), realpathSync('node_modules')] }
    }
  })
  await server.listen()
  url = `${server.resolvedUrls!.local[0]}tests/fixtures/file-workspace.html`
})
test.afterAll(async () => {
  await server?.close()
})

test('real app file workspace: navigation, drafts, menus, collapse and narrow layouts', async () => {
  test.setTimeout(120000)
  const executablePath = [
    process.env.CLB_HEADLESS_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    chromium.executablePath()
  ].find((path) => path && existsSync(path))
  expect(
    executablePath,
    'An installed Chromium browser is required; no desktop session is used'
  ).toBeTruthy()
  const browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write']
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort()
  )
  const evidence = resolve('playwright-report/file-workspace-redesign')
  await mkdir(evidence, { recursive: true })
  try {
    await page.goto(url)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('12px "Mona Sans"'))).toBe(true)
    const reference = (name: string) =>
      page.locator('.conversation-area .file-reference').filter({ hasText: name })
    await reference('notes.md').click()
    const panel = page.locator('#remote-files-panel')
    await expect(panel.getByRole('heading', { name: '文件栏重做' })).toBeVisible()
    await expect(panel.locator('.panel-dock-header')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: '文件操作' })).toBeVisible()
    await expect(panel.getByRole('button', { name: '文件操作' })).toHaveCSS('opacity', '1')
    const header = (await panel.locator('header').boundingBox())!
    const tabs = (await panel.locator('.dock-tabs').boundingBox())!
    expect(tabs.y).toBeCloseTo(header.y, 0)
    expect(header.height).toBeLessThanOrEqual(38)
    await page.screenshot({ path: `${evidence}/preview-light.png` })
    const directoryToggle = panel.getByRole('button', { name: '目录侧栏', exact: true })
    await expect(panel.getByRole('button', { name: '浏览文件夹' })).toHaveCount(0)
    const toggleBounds = (await directoryToggle.boundingBox())!
    const actionBounds = (await panel.getByRole('button', { name: '文件操作' }).boundingBox())!
    expect(toggleBounds.x).toBeGreaterThan(actionBounds.x + actionBounds.width)
    expect(header.x + header.width - toggleBounds.x - toggleBounds.width).toBeLessThanOrEqual(6)
    await directoryToggle.click()
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '文件栏重做' })).toBeVisible()
    const directoryBounds = (await panel
      .locator('.remote-directory-browser:visible')
      .boundingBox())!
    const documentBounds = (await panel.locator('.remote-file-document:visible').boundingBox())!
    expect(directoryBounds.x).toBeGreaterThan(documentBounds.x + documentBounds.width)
    expect(documentBounds.width).toBeGreaterThanOrEqual(239)
    await page.screenshot({ path: `${evidence}/directory-sidebar.png` })
    await panel.getByRole('button', { name: 'docs', exact: true }).click()
    await panel.getByRole('button', { name: 'guide.md', exact: true }).click()
    await expect(panel.getByRole('heading', { name: '使用说明' })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace/docs')
    await panel.getByRole('button', { name: '目录侧栏' }).click()
    await expect(panel.locator('.remote-file-document:visible')).toHaveCount(1)
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeHidden()
    await directoryToggle.click()
    await expect(panel.getByRole('heading', { name: '使用说明' })).toBeVisible()
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('.dock-layout')!
        .style.setProperty('--dock-width', '680px')
    )
    const directorySizer = panel.getByRole('separator', { name: '调整目录侧栏宽度' })
    await expect(directorySizer).toHaveAttribute('aria-valuenow', '220')
    await directorySizer.press('ArrowLeft')
    await expect(directorySizer).toHaveAttribute('aria-valuenow', '236')
    const sash = (await directorySizer.boundingBox())!
    await page.mouse.move(sash.x + 2, sash.y + 90)
    await page.mouse.down()
    await page.mouse.move(sash.x - 38, sash.y + 90, { steps: 4 })
    await page.mouse.up()
    const preferredInnerWidth = await directorySizer.getAttribute('aria-valuenow')
    expect(Number(preferredInnerWidth)).toBeGreaterThan(270)
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: `${evidence}/directory-sidebar-wide-dark.png` })
    await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '右侧栏', exact: true }).click()
    await expect(directoryToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace/docs')
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('.dock-layout')!
        .style.setProperty('--dock-width', '300px')
    )
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeHidden()
    await expect(panel.getByRole('heading', { name: '使用说明' })).toBeVisible()
    await panel.getByRole('button', { name: '目录侧栏' }).click()
    await expect(panel.locator('.file-directory-hint')).toBeVisible()
    await panel.getByRole('button', { name: 'guide.md', exact: true }).click()
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeHidden()
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('.dock-layout')!
        .style.setProperty('--dock-width', '680px')
    )
    await expect(directorySizer).toHaveAttribute('aria-valuenow', preferredInnerWidth!)
    await panel.getByRole('tab', { name: 'notes.md' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '在文件夹中显示' }).click()
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace')
    await expect(panel.getByRole('heading', { name: '文件栏重做' })).toBeVisible()
    await panel.getByRole('button', { name: '关闭 guide.md' }).click()
    await directoryToggle.click()
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('.dock-layout')!
        .style.setProperty('--dock-width', '480px')
    )
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeHidden()
    await panel.getByRole('button', { name: '编辑', exact: true }).click()
    await panel.getByRole('textbox', { name: '文件内容' }).fill('# Draft survives')
    await panel.getByRole('button', { name: '目录侧栏' }).click()
    await expect(panel.locator('.remote-file-document:visible')).toHaveCount(1)
    await panel.getByRole('button', { name: 'docs', exact: true }).click()
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace/docs')
    await panel.getByRole('button', { name: 'guide.md', exact: true }).click()
    await expect(panel.getByRole('heading', { name: '使用说明' })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace/docs')
    await panel.getByRole('tab', { name: 'notes.md' }).click()
    await expect(panel.getByRole('textbox', { name: '文件内容' })).toHaveValue('# Draft survives')
    await panel.getByRole('button', { name: '保存', exact: true }).click()
    await expect(panel.getByText('已保存', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '关闭 guide.md' }).click()
    await expect(panel.getByRole('tab', { name: 'notes.md' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await panel.getByRole('button', { name: '目录侧栏' }).click()
    // External references preserve the collapsed directory sidebar.
    await reference('notes.md').click()
    await expect(panel.getByRole('button', { name: '目录侧栏' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await panel.getByRole('tab', { name: 'notes.md' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '在文件夹中显示' }).click()
    await expect(panel.getByRole('textbox', { name: '文件夹路径' })).toHaveValue('/workspace')
    await panel.getByRole('button', { name: 'archive.zip', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '下载文件…' }).click()
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).fileFixtureCalls.some(
            (call: any) => call.operation === 'download' && call.path === '/workspace/archive.zip'
          )
        )
      )
      .toBe(true)
    await page.locator('.toast button').click()
    await panel.getByRole('button', { name: 'archive.zip', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('无法预览')
    await panel.getByRole('button', { name: '文件操作' }).click()
    await expect(page.getByRole('menuitem', { name: '下载文件…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await panel.getByRole('button', { name: '关闭 archive.zip' }).click()
    await reference('guide.md').click()
    await reference('source').click()
    // A collapsed rail preserves documents; file/terminal icons toggle the active sidebar.
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    await expect(panel).toBeHidden()
    await page.getByRole('button', { name: '右侧栏', exact: true }).click()
    await expect(panel).toBeVisible()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '终端', exact: true })
      .click()
    await expect(page.locator('.terminal-drawer')).toBeVisible()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '终端', exact: true })
      .click()
    await expect(page.locator('.terminal-drawer')).toBeHidden()
    await page.getByRole('button', { name: '右侧栏', exact: true }).click()
    await page
      .locator('.panel-tool-rail')
      .getByRole('button', { name: '文件', exact: true })
      .click()
    // A 300 px dock leaves about 264 px for file controls after the rail.
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('.dock-layout')!
        .style.setProperty('--dock-width', '300px')
    )
    await panel.getByRole('button', { name: '目录侧栏' }).click()
    const pane = (await panel.boundingBox())!
    const directory = (await panel.locator('.remote-directory-browser:visible').boundingBox())!
    expect(directory.width).toBeCloseTo(pane.width, 0)
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true
    )
    for (const control of ['目录侧栏', '文件操作', '前往', '刷新目录']) {
      const bounds = (await panel
        .getByRole('button', { name: control, exact: true })
        .boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(pane.x)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(pane.x + pane.width + 1)
    }
    await panel.getByRole('button', { name: 'notes.md', exact: true }).click({ button: 'right' })
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(menu.x + menu.width).toBeLessThanOrEqual(1360)
    await page.screenshot({ path: `${evidence}/browser-narrow-menu.png` })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: `${evidence}/browser-dark.png` })
    await panel.getByRole('button', { name: '返回文件' }).click()
    const activeTab = (await panel.getByRole('tab', { selected: true }).boundingBox())!
    const tabStrip = (await panel.locator('.dock-tabs').boundingBox())!
    expect(activeTab.x).toBeGreaterThanOrEqual(tabStrip.x - 1)
    expect(activeTab.x + activeTab.width).toBeLessThanOrEqual(tabStrip.x + tabStrip.width + 1)
    await page.screenshot({ path: `${evidence}/tabs-narrow-dark.png` })
    await page.getByRole('button', { name: '底部栏', exact: true }).click()
    await expect(page.locator('.terminal-drawer')).toBeVisible()
    const fileBox = (await panel.boundingBox())!
    const terminalBox = (await page.locator('.terminal-drawer').boundingBox())!
    expect(fileBox.y + fileBox.height).toBeLessThanOrEqual(terminalBox.y + 1)
    await page.getByRole('button', { name: '全屏右侧栏' }).click()
    expect((await panel.boundingBox())!.width).toBeGreaterThan(1300)
    await page.getByRole('button', { name: '还原右侧栏' }).click()
    await page.setViewportSize({ width: 680, height: 720 })
    await panel.getByRole('button', { name: '目录侧栏' }).click()
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true
    )
    await page.screenshot({ path: `${evidence}/small-window.png` })
    while (await panel.getByRole('tab').count()) {
      await panel.locator('.dock-document-close').first().click()
    }
    await expect(panel.getByRole('region', { name: '文件夹浏览' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await browser.close()
  }
})
