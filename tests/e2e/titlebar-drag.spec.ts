import { _electron as electron, expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { fixture } from './workspace-fixture'

test('title-bar whitespace is a native caption while controls remain interactive', async () => {
  test.skip(process.platform !== 'win32')
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/titlebar-drag-${Date.now()}`)
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
    const handle = await app.evaluate(({ BrowserWindow }) =>
      Number(BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle().readBigUInt64LE())
    )
    const points = await page.evaluate(() => {
      const title = document
        .querySelector('.app-titlebar .workspace-title')!
        .getBoundingClientRect()
      const name = document.querySelector('.app-titlebar h1')!.getBoundingClientRect()
      const toggle = document.querySelector('[data-open-files]')!.getBoundingClientRect()
      return {
        blank: {
          x: (name.right + title.right) / 2 / innerWidth,
          y: (title.top + title.height / 2) / innerHeight
        },
        button: {
          x: (toggle.left + toggle.width / 2) / innerWidth,
          y: (toggle.top + toggle.height / 2) / innerHeight
        },
        gap: title.right - name.right
      }
    })
    expect(points.gap).toBeGreaterThan(30)
    const hit = async (point: { x: number; y: number }): Promise<number> => {
      const result = await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          resolve('tests/e2e/windows-hit-test.ps1'),
          '-Handle',
          String(handle),
          '-X',
          String(point.x),
          '-Y',
          String(point.y)
        ],
        { windowsHide: true }
      )
      return Number(result.stdout.trim())
    }
    // WM_NCHITTEST is the native decision Windows uses to begin dragging.
    expect(await hit(points.blank)).toBe(2) // HTCAPTION
    expect(await hit(points.button)).toBe(1) // HTCLIENT
    await page.locator('[data-open-files]').click()
    await expect(page.getByRole('complementary', { name: '远程文件', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '文件', exact: true }).click()
    await expect(page.getByRole('menu', { name: '文件', exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
