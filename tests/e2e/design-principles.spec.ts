import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'

test('centered and full reading preserve alignment and quiet but accessible controls', async () => {
  test.setTimeout(90000)
  const folder = resolve('playwright-report/codex-frontend-migration/design-principles')
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
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const target = { profileId: 'mas', sessionName: 'claude-review' }
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'code',
        kind: 'assistant',
        text:
          '```typescript\nconst example = "' +
          'wide_code_'.repeat(40) +
          '"\n```\n\n' +
          '可读的段落。'.repeat(80),
        isFinal: true
      }
    })
    await expect(page.locator('.code-block')).toBeVisible()
    await expect(page.locator('.session-entry.selected .session-important-state')).toHaveCount(0)
    await expect(page.locator('.activity-group-header')).not.toContainText('0 条更新')
    await expect(page.locator('.composer-upload')).toHaveAccessibleName('上传文件')
    await expect(page.locator('.send-button')).toHaveAccessibleName('发送')
    await expect(page.locator('.send-button')).toHaveText('')
    await expect(page.locator('.cm-content')).toBeFocused()
    const normal = await page
      .locator('.new-session-button')
      .evaluate((node) => getComputedStyle(node).backgroundColor)
    expect(normal).toBe('rgba(0, 0, 0, 0)')
    const systemScaleFactor = await app.evaluate(
      ({ screen }) => screen.getPrimaryDisplay().scaleFactor
    )
    const measurements: unknown[] = []
    for (const variant of [
      {
        label: 'centered',
        width: 1440,
        height: 920,
        zoom: 1,
        full: false,
        dark: false,
        split: false,
        long: false
      },
      {
        label: 'full',
        width: 1440,
        height: 920,
        zoom: 1,
        full: true,
        dark: false,
        split: false,
        long: false
      },
      {
        label: 'dark',
        width: 1440,
        height: 920,
        zoom: 1,
        full: false,
        dark: true,
        split: false,
        long: false
      },
      {
        label: 'split',
        width: 1440,
        height: 920,
        zoom: 1,
        full: false,
        dark: true,
        split: true,
        long: false
      },
      {
        label: 'narrow-150',
        width: 980,
        height: 680,
        zoom: 1.5,
        full: false,
        dark: true,
        split: false,
        long: false
      },
      {
        label: 'long-input',
        width: 1440,
        height: 920,
        zoom: 1,
        full: false,
        dark: false,
        split: false,
        long: true
      }
    ]) {
      await app.evaluate(({ BrowserWindow }, v) => {
        const win = BrowserWindow.getAllWindows()[0]!
        win.setSize(v.width, v.height)
        win.webContents.setZoomFactor(v.zoom)
      }, variant)
      const wanted = variant.full ? '切换到居中阅读' : '切换到全宽阅读'
      if (!(await page.getByRole('button', { name: wanted, exact: true }).count()))
        await page.locator('.reading-width-toggle').click()
      if (
        (await page.locator('html').getAttribute('data-theme')) !==
        (variant.dark ? 'dark' : 'light')
      )
        await page
          .getByRole('button', { name: variant.dark ? '切换到深色主题' : '切换到浅色主题' })
          .click()
      await page.getByRole('button', { name: variant.split ? '分屏' : '对话', exact: true }).click()
      await page.locator('.cm-content').fill(variant.long ? '长草稿继续编辑\n'.repeat(80) : '')
      await page.locator('.timeline').evaluate((node) => {
        node.scrollTop = 0
      })
      await page.evaluate(async () => {
        await document.fonts.ready
        for (const animation of document.getAnimations()) {
          if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
            try {
              animation.finish()
            } catch {
              /* Infinite or idle effects do not block capture. */
            }
          }
        }
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        )
      })
      const geometry = await page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect()
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom
          }
        }
        return {
          reading: box('.timeline-inner'),
          composer: box('.composer-area'),
          viewport: box('.timeline'),
          send: box('.send-button'),
          overflow: document.documentElement.scrollWidth > innerWidth,
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio
        }
      })
      expect(geometry.overflow).toBe(false)
      expect(
        Math.abs(
          geometry.reading.x +
            geometry.reading.width / 2 -
            geometry.composer.x -
            geometry.composer.width / 2
        )
      ).toBeLessThan(1)
      expect(Math.abs(geometry.reading.width - geometry.composer.width)).toBeLessThan(1)
      expect(geometry.send.bottom).toBeLessThanOrEqual(geometry.height)
      expect(geometry.viewport.height).toBeGreaterThan(100)
      measurements.push({
        ...variant,
        windowWidth: variant.width,
        windowHeight: variant.height,
        systemScaleFactor,
        ...geometry,
        font: 'Mona Sans, system CJK fallback',
        replySize: 14,
        lineHeight: 1.75
      })
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
          .toPNG()
          .toString('base64')
      )
      await writeFile(resolve(folder, `${variant.label}.png`), Buffer.from(png, 'base64'))
    }
    const reply = page.locator('[data-timeline-id="reply"]')
    const markdownCopy = reply.getByRole('button', {
      name: '复制回复（Markdown 原文）',
      exact: true
    })
    await markdownCopy.focus()
    await page.keyboard.press('Enter')
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('## 回测结果检查')
    await expect(reply.getByRole('status').first()).toContainText('已复制')
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async () => {
          throw new Error('Test clipboard unavailable')
        }
      })
    })
    await reply.getByRole('button', { name: '复制纯文本', exact: true }).click()
    await expect(reply.locator('.copy-error')).toBeVisible()
    await command(app, { type: 'status', target, status: { readOnly: true } })
    await expect(page.locator('.session-entry.selected .session-status-icon')).toHaveAccessibleName(
      '只读观察'
    )
    await expect(page.locator('.send-button')).toBeDisabled()
    await expect(page.locator('.composer-upload')).toBeDisabled()
    await command(app, { type: 'status', target, status: { state: 'reconnecting' } })
    await expect(page.locator('.session-entry.selected .session-status-icon')).toHaveAccessibleName(
      '正在重连'
    )
    await writeFile(resolve(folder, 'measurements.json'), JSON.stringify(measurements, null, 2))
  } finally {
    await app.close()
  }
})
