import { chromium, expect, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

let server: ViteDevServer
let url: string
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: resolve('.'),
    cacheDir: resolve('test-results', `outline-vite-${process.env.CLB_TEST_RUN_ID}`),
    server: { host: '127.0.0.1', port: 0 }
  })
  await server.listen()
  url = `${server.resolvedUrls!.local[0]}tests/fixtures/conversation-outline.html`
})
test.afterAll(async () => {
  await server?.close()
})

test('outline previews and navigates real conversation turns in an isolated browser', async () => {
  const testInfo = test.info()
  test.setTimeout(120000)
  const executablePath = [
    process.env.CLB_HEADLESS_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    chromium.executablePath()
  ].find((path) => path && existsSync(path))
  expect(executablePath).toBeTruthy()
  const browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort()
  )
  try {
    await page.goto(url)
    await expect(page.locator('.timeline')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '对话大纲' })).toHaveCount(0)
    await page.evaluate(() => (window as any).outlineFixture.seed())
    const rail = page.getByRole('navigation', { name: '对话大纲' })
    const items = rail.getByRole('button')
    const lines = rail.locator('.conversation-outline-line')
    const preview = page.getByRole('tooltip')
    await expect(items).toHaveCount(24)
    await expect
      .poll(() =>
        lines.evaluateAll((nodes) =>
          nodes.every((node) => node.getBoundingClientRect().width === 10)
        )
      )
      .toBe(true)
    await expect(preview).toHaveCount(0)
    await page.screenshot({
      path: testInfo.outputPath('outline-resting.png'),
      animations: 'disabled'
    })
    const scrollTop = await page.locator('.timeline').evaluate((node) => node.scrollTop)
    await items.nth(10).hover()
    await expect(preview.locator('strong')).toContainText('第 11 轮：')
    await expect(preview.locator('p')).toContainText('第 11 轮回答：')
    await expect(preview).not.toContainText('执行过程')
    await expect(preview.locator('strong')).toHaveCSS('font-weight', '650')
    await expect(lines.nth(10)).toHaveCSS('width', '34px')
    const widths = await lines.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width)
    )
    expect(widths[10]).toBeGreaterThan(widths[9]!)
    expect(widths[9]).toBeGreaterThan(widths[8]!)
    expect(widths[9]).toBeCloseTo(widths[11]!, 0)
    expect(await page.locator('.timeline').evaluate((node) => node.scrollTop)).toBe(scrollTop)
    await page.screenshot({
      path: testInfo.outputPath('outline-hover-light.png'),
      animations: 'disabled'
    })
    await preview.hover()
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    await items.nth(10).click()
    const prompt = page.locator('[data-outline-turn="prompt-10"]')
    const offset = () =>
      prompt.evaluate(
        (node) =>
          node.getBoundingClientRect().top -
          document.querySelector('.timeline')!.getBoundingClientRect().top
      )
    await expect.poll(offset).toBeCloseTo(0, 0)
    await expect(items.nth(10)).toHaveAttribute('aria-current', 'location')
    await page.mouse.move(800, 100)
    await expect(preview).toHaveCount(0)
    await expect(lines.nth(10)).toHaveCSS('width', '10px')
    await page.evaluate(() => (window as any).outlineFixture.append())
    await expect.poll(offset).toBeCloseTo(0, 0)
    // Search must not restore its old position after an outline navigation.
    await page.keyboard.press('Control+f')
    await page.getByRole('searchbox').fill('第 3 轮回答')
    await items.nth(5).click()
    await expect(page.getByRole('searchbox')).toHaveCount(0)
    await expect(items.nth(5)).toHaveAttribute('aria-current', 'location')
    await items.nth(5).focus()
    await page.keyboard.press('ArrowDown')
    await expect(preview.locator('strong')).toContainText('第 7 轮：')
    await page.keyboard.press('Enter')
    await expect(items.nth(6)).toHaveAttribute('aria-current', 'location')
    await page.keyboard.press('Escape')
    await expect(preview).toHaveCount(0)
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await items.nth(7).hover()
    await expect(preview.locator('strong')).toContainText('第 8 轮：')
    await page.screenshot({
      path: testInfo.outputPath('outline-hover-dark.png'),
      animations: 'disabled'
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await lines.first().evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))
    ).toBeLessThanOrEqual(0.001)
    await expect(preview).toHaveCSS('animation-name', 'none')
    await page.evaluate(() => (window as any).outlineFixture.pending())
    await items.last().hover()
    await expect(preview.locator('strong')).toHaveText('尚未收到回答的问题')
    await expect(preview.locator('p')).toHaveText('暂无回答')
    await page.evaluate(() => (window as any).outlineFixture.fail())
    await expect(items).toHaveCount(25)
    await page.setViewportSize({ width: 740, height: 580 })
    await items.nth(12).hover()
    const card = (await preview.boundingBox())!
    const shell = (await page.locator('.timeline-shell').boundingBox())!
    expect(card.x).toBeGreaterThanOrEqual(shell.x)
    expect(card.x + card.width).toBeLessThanOrEqual(shell.x + shell.width)
    expect(card.y).toBeGreaterThanOrEqual(shell.y)
    expect(card.y + card.height).toBeLessThanOrEqual(shell.y + shell.height)
    await page.screenshot({
      path: testInfo.outputPath('outline-narrow.png'),
      animations: 'disabled'
    })
    // Every turn remains reachable when the rail is taller than the viewport.
    await page.evaluate(() => (window as any).outlineFixture.seed(180))
    await expect(items).toHaveCount(180)
    await items.nth(10).focus()
    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()
    await expect(preview.locator('strong')).toContainText('第 180 轮：')
    await page.keyboard.press('Enter')
    await expect(items.last()).toHaveAttribute('aria-current', 'location')
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(items.first()).toHaveAttribute('aria-current', 'location')
    expect(errors).toEqual([])
  } finally {
    await context.close()
    await browser.close()
  }
})
