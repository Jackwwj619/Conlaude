import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

const folder = resolve('playwright-report/codex-frontend-migration/matrix')
test('cross-page visual matrix keeps reading, controls and fonts accessible', async () => {
  test.setTimeout(180000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve('test-results', `matrix-${Date.now()}`)
    }
  })
  const records: unknown[] = []
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await fixture(app)
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({
        generatedAt: new Date().toISOString(),
        checks: [
          {
            id: 'remote-tools',
            label: 'Remote tools',
            status: 'ok',
            detail: 'Isolated UI fixture: tmux and Claude available'
          },
          {
            id: 'ssh-connectivity',
            label: 'SSH',
            status: 'warning',
            detail: 'Representative connection warning; no remote operation performed.'
          }
        ]
      }))
    }, IPC.diagnosticsRun)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const capture = async (name: string): Promise<void> => {
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined))
        )
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        )
      })
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
          .toPNG()
          .toString('base64')
      )
      await writeFile(resolve(folder, `${name}.png`), Buffer.from(png, 'base64'))
    }
    for (const theme of ['light', 'dark'] as const)
      for (const language of ['zh-CN', 'en-US'] as const) {
        await page.evaluate(
          async ({ theme, language }) => {
            const settings = await window.claudeBridge.settings.get()
            await window.claudeBridge.settings.update({
              ...settings,
              theme,
              language,
              conversation: {
                ...settings.conversation,
                fontSize: language === 'en-US' ? 18 : 14,
                lineHeight: 1.65
              }
            })
          },
          { theme, language }
        )
        await page.reload()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await command(app, {
          type: 'event',
          target: { profileId: 'mas', sessionName: 'claude-review' },
          event: {
            id: 'matrix-content',
            kind: 'assistant',
            isFinal: true,
            text:
              '## 内容与宽度 Content\n\n- Nested list\n  - 中文与 English\n\n```typescript\nconst path = "' +
              'very-long-path/'.repeat(15) +
              '";\n```\n\n| Column A | Column B | Column C |\n| :--- | ---: | --- |\n| ' +
              'wide_value_'.repeat(12) +
              ' | 42 | 中文 |\n\n$x^2+y^2$'
          }
        })
        for (const size of [
          [1440, 920],
          [980, 680],
          [1536, 824]
        ])
          for (const zoom of [1, 1.25, 1.5]) {
            await app.evaluate(
              ({ BrowserWindow }, { size, zoom }) => {
                const win = BrowserWindow.getAllWindows()[0]!
                win.setSize(size[0]!, size[1]!)
                win.webContents.setZoomFactor(zoom)
              },
              { size, zoom }
            )
            await expect
              .poll(async () => {
                const dimensions = await app.evaluate(({ BrowserWindow }) =>
                  BrowserWindow.getAllWindows()[0]!.getContentSize()
                )
                return page.evaluate(
                  ({ dimensions, zoom }) =>
                    Math.abs(innerWidth - dimensions[0]! / zoom) < 2 &&
                    Math.abs(innerHeight - dimensions[1]! / zoom) < 2,
                  { dimensions, zoom }
                )
              })
              .toBe(true)
            await page.locator('.timeline').evaluate((node) => {
              node.scrollTop = 0
            })
            const geometry = await page.evaluate(() => {
              const rect = (selector: string) => {
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
                viewport: [innerWidth, innerHeight],
                title: rect('.app-titlebar'),
                sidebar: rect('.task-sidebar'),
                reading: rect('.timeline'),
                message: rect('.timeline-inner'),
                composer: rect('.composer-area'),
                send: rect('.send-button'),
                overflow: document.documentElement.scrollWidth > innerWidth
              }
            })
            expect(geometry.overflow).toBe(false)
            expect(geometry.send.right).toBeLessThanOrEqual(geometry.viewport[0]! + 1)
            expect(geometry.send.bottom).toBeLessThanOrEqual(geometry.viewport[1]! + 1)
            expect(geometry.reading.height).toBeGreaterThan(100)
            records.push({ theme, language, size, zoom, ...geometry })
            await capture(`${theme}-${language}-${size.join('x')}-${zoom}`)
          }
        await page
          .getByRole('button', { name: language === 'zh-CN' ? '设置' : 'Settings', exact: true })
          .click()
        await capture(`${theme}-${language}-settings`)
        await page
          .getByRole('button', { name: language === 'zh-CN' ? '外观' : 'Appearance', exact: true })
          .click()
        await page
          .getByRole('combobox', {
            name: language === 'zh-CN' ? '界面字体' : 'Interface font',
            exact: true
          })
          .click()
        await expect(page.locator('.font-popup')).toBeVisible()
        await capture(`${theme}-${language}-fonts`)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await page
          .getByRole('button', {
            name: language === 'zh-CN' ? '管理服务器' : 'Manage servers',
            exact: true
          })
          .click()
        await capture(`${theme}-${language}-servers`)
        await page
          .locator('.server-card')
          .first()
          .getByRole('button', { name: /编辑服务器|Edit server/ })
          .click()
        await expect(page.getByRole('dialog')).toHaveCount(1)
        await capture(`${theme}-${language}-server-editor`)
        await page.keyboard.press('Escape')
        await page
          .getByRole('button', {
            name: language === 'zh-CN' ? '连接诊断' : 'Connection diagnostics',
            exact: true
          })
          .click()
        await expect(page.locator('.diagnostic-item')).toHaveCount(2)
        await expect(page.getByRole('dialog')).toHaveCount(1)
        await capture(`${theme}-${language}-diagnostics`)
        await page.keyboard.press('Escape')
        await page.locator('.library-return').click()
        await page
          .getByRole('button', { name: language === 'zh-CN' ? '文件' : 'File', exact: true })
          .click()
        await capture(`${theme}-${language}-menu`)
        await page.keyboard.press('Escape')
      }
    expect(errors).toEqual([])
    await writeFile(
      resolve(folder, 'measurements.json'),
      JSON.stringify({ records, errors }, null, 2)
    )
  } finally {
    await app.close()
  }
})
