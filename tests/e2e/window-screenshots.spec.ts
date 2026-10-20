import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

test('isolated window captures include native captions and retain titlebar safe area', async () => {
  test.setTimeout(90000)
  const folder = resolve('playwright-report/codex-frontend-migration/window')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `captions-${Date.now()}`)
    }
  })
  try {
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            typeof (
              globalThis as unknown as {
                resumeOfflineRenderer?: () => Promise<void>
              }
            ).resumeOfflineRenderer
        )
      )
      .toBe('function')
    await fixture(app)
    await app.evaluate(() =>
      (
        globalThis as unknown as {
          resumeOfflineRenderer: () => Promise<void>
        }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const records: unknown[] = []
    for (const theme of ['light', 'dark'] as const) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: '切换到深色主题' }).click()
      // Mock settings IPC does not update nativeTheme; set its corresponding
      // test state explicitly so the real main-process theme listener runs.
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = theme
      }, theme)
      for (const maximized of [false, true]) {
        await app.evaluate(({ BrowserWindow }, maximized) => {
          const win = BrowserWindow.getAllWindows()[0]!
          if (maximized) win.maximize()
          else {
            win.unmaximize()
            win.setSize(1100, 760)
          }
        }, maximized)
        await expect
          .poll(() =>
            app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())
          )
          .toBe(maximized)
        for (const zoom of [1, 1.5]) {
          await app.evaluate(({ BrowserWindow }, zoom) => {
            const win = BrowserWindow.getAllWindows()[0]!
            win.webContents.setZoomFactor(zoom)
          }, zoom)
          await page.evaluate(
            () =>
              new Promise<void>((done) =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
              )
          )
          const geometry = await page.evaluate(() => {
            const bar = document.querySelector('.app-titlebar')!
            const controls = document.querySelector('.header-actions')!
            return {
              width: innerWidth,
              right: controls.getBoundingClientRect().right,
              drag: getComputedStyle(bar).getPropertyValue('-webkit-app-region'),
              menuDrag: getComputedStyle(
                document.querySelector('.app-menu-trigger')!
              ).getPropertyValue('-webkit-app-region')
            }
          })
          expect(geometry.right).toBeLessThanOrEqual(geometry.width - 140)
          expect(geometry.drag).toBe('drag')
          expect(geometry.menuDrag).toBe('no-drag')
          const shot = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
            const win = BrowserWindow.getAllWindows()[0]!
            const sources = await desktopCapturer.getSources({
              types: ['window'],
              thumbnailSize: { width: 1920, height: 1080 }
            })
            const source = sources.find((s) => s.id === win.getMediaSourceId())
            return source
              ? {
                  png: source.thumbnail.toPNG().toString('base64'),
                  size: source.thumbnail.getSize(),
                  focused: win.isFocused()
                }
              : undefined
          })
          expect(shot?.size.width).toBeGreaterThan(500)
          await writeFile(
            resolve(folder, `${theme}-${maximized ? 'maximized' : 'normal'}-${zoom}.png`),
            Buffer.from(shot!.png, 'base64')
          )
          records.push({
            theme,
            maximized,
            zoom,
            ...geometry,
            size: shot!.size,
            focused: shot!.focused
          })
        }
      }
    }
    // Focus a second window owned by this test app; no desktop input injection.
    await app.evaluate(async ({ BrowserWindow }) => {
      const probe = new BrowserWindow({ width: 200, height: 100, show: false, skipTaskbar: true })
      await probe.loadURL('data:text/html,<title>Focus verification</title>')
      probe.show()
      probe.focus()
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => !win.webContents.getURL().startsWith('data:'))!
            .isFocused()
        )
      )
      .toBe(false)
    const inactive = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows().find(
        (win) => !win.webContents.getURL().startsWith('data:')
      )!
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      const source = sources.find((s) => s.id === win.getMediaSourceId())!
      return { png: source.thumbnail.toPNG().toString('base64'), focused: win.isFocused() }
    })
    expect(inactive.focused).toBe(false)
    await writeFile(
      resolve(folder, 'dark-maximized-inactive.png'),
      Buffer.from(inactive.png, 'base64')
    )
    records.push({ theme: 'dark', maximized: true, zoom: 1.5, focused: inactive.focused })
    await writeFile(resolve(folder, 'measurements.json'), JSON.stringify(records, null, 2))
  } finally {
    await app.close()
  }
})
