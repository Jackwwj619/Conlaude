import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { command, fixture } from './workspace-fixture'

test('bottom status bar contains long destinations without moving adjacent controls', async () => {
  const folder = resolve('playwright-report/status-bar-layout')
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
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(async () => {
      const settings = await window.claudeBridge.settings.get()
      await window.claudeBridge.settings.update({
        ...settings,
        language: 'en-US',
        profiles: settings.profiles.map((profile) => ({
          ...profile,
          sshHost: `${profile.id}-research-compute-server-with-a-long-name`,
          defaultCwd:
            '/home/user/research/projects/experiments/long-directory-name/results/current-run'
        }))
      })
    })
    await page.reload()
    await page.locator('.sidebar-server').first().click()
    await page.locator('.session-entry[title*="claude-review"]').first().click()
    await expect(page.locator('.status-bar .composer-state')).toContainText('Ready to send')
    await expect(page.locator('.composer-area .composer-context')).toHaveCount(0)
    await expect(page.locator('.status-bar')).not.toContainText(/Ctrl\s*\+?\s*K/i)
    for (const [width, height, zoom] of [
      [1440, 920, 1],
      [980, 680, 1],
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
      // Zoom applies container-query styles on the following rendering frames.
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          )
      )
      const measure = () =>
        page.evaluate(() => {
          const box = (selector: string) => {
            const element = document.querySelector(selector)!
            const rect = element.getBoundingClientRect()
            return { x: rect.x, right: rect.right, bottom: rect.bottom, width: rect.width }
          }
          return {
            bar: box('.status-bar'),
            state: box('.composer-state'),
            server: box('.status-bar-server'),
            path: box('.status-bar-path'),
            theme: box('.status-bar button'),
            height: innerHeight,
            overflow: document.documentElement.scrollWidth > innerWidth
          }
        })
      const before = await measure()
      expect(before.overflow).toBe(false)
      expect(before.bar.bottom).toBeCloseTo(before.height, 0)
      expect(before.state.right).toBeLessThanOrEqual(before.server.x + 1)
      expect(before.server.right).toBeLessThanOrEqual(before.path.x + 1)
      expect(before.path.right).toBeLessThanOrEqual(before.theme.x)
      expect(before.path.width).toBeGreaterThan(60)
      expect(before.theme.width).toBeGreaterThan(20)
      await command(app, {
        type: 'status',
        target: { profileId: 'mas', sessionName: 'claude-review' },
        status: { generating: true }
      })
      await expect(page.locator('.composer-state svg')).toHaveClass(/spin/)
      const after = await measure()
      expect(after.server.x).toBe(before.server.x)
      expect(after.path.x).toBe(before.path.x)
      expect(after.theme.x).toBe(before.theme.x)
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
      )
      await writeFile(resolve(folder, `status-bar-${width}-${zoom}.png`), Buffer.from(png, 'base64'))
      await command(app, {
        type: 'status',
        target: { profileId: 'mas', sessionName: 'claude-review' },
        status: { generating: false }
      })
    }
  } finally {
    await app.close()
  }
})
