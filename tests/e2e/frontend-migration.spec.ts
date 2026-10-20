import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import type { SessionTarget } from '../../src/shared/contracts'

const root = resolve(import.meta.dirname, '../..')
const evidence = resolve(root, 'playwright-report/codex-frontend-migration')

test('unified title bar, sidebar toggle, editing ownership and responsive reading area', async () => {
  test.setTimeout(120000)
  await mkdir(evidence, { recursive: true })
  const app = await electron.launch({
    ...(process.env.CLB_MIGRATION_EXECUTABLE
      ? { executablePath: process.env.CLB_MIGRATION_EXECUTABLE, args: [] }
      : { args: ['.'] }),
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(root, `test-results/migration-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle('Conlaude')
    expect(await app.evaluate(({ app }) => app.getName())).toBe('Conlaude')
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await app.evaluate(
      ({ ipcMain, BrowserWindow }, { channels, defaults }) => {
        const settings = {
          ...defaults,
          theme: 'light',
          profiles: [
            { ...defaults.profiles[0]!, id: 'test', label: 'Migration', defaultCwd: '/workspace' }
          ],
          currentProfileId: 'test'
        }
        const handle = (channel: string, fn: (value: SessionTarget) => unknown): void => {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, (_event, value) => fn(value))
        }
        handle(channels.settingsGet, () => settings)
        handle(channels.helperStatus, () => ({ installed: true }))
        handle(channels.sessionsList, () => [
          {
            name: 'claude-layout',
            windows: 1,
            attachedClients: 0,
            currentPath: '/workspace',
            isClaude: true
          }
        ])
        handle(channels.sessionsAttach, (target) => {
          const window = BrowserWindow.getAllWindows()[0]!
          const status = {
            ...target,
            state: 'attached',
            readOnly: false,
            promptState: 'ready',
            attempt: 0,
            changedAt: Date.now()
          }
          window.webContents.send(channels.event, { type: 'session-status', status })
          window.webContents.send(channels.event, {
            type: 'timeline-event',
            target,
            event: {
              id: 'layout',
              kind: 'assistant',
              text:
                '## 大内容区检查\n\n正文、代码、表格应充分使用可用空间。\n\n```typescript\nconst sample = "' +
                'wide content '.repeat(30) +
                '"\n```\n\n| Name | Value | Details |\n| --- | --- | --- |\n| Example | 42 | ' +
                'wide_table_'.repeat(35) +
                ' |'
            }
          })
          return status
        })
        handle(channels.terminalResize, () => undefined)
        handle(channels.sessionsDetach, () => undefined)
      },
      { channels: IPC, defaults: DEFAULT_SETTINGS }
    )
    await page.reload()
    await expect(page.locator('.app-titlebar')).toBeVisible()
    await expect(page.locator('.titlebar-logo')).toHaveCount(0)
    await expect(page.locator('.sidebar-visibility-toggle')).toBeVisible()
    await page.locator('.sidebar-server').first().click()
    await page.locator('.session-entry').filter({ hasText: 'claude-layout' }).click()
    await expect(page.locator('.timeline-inner')).toContainText('大内容区检查')
    const editor = page.locator('.cm-content')
    await editor.fill('draft one')
    await editor.press('End')
    await page.keyboard.type(' two')
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('menuitem', { name: '全选', exact: true }).click()
    await page.keyboard.type('replacement')
    await expect(editor).toHaveText('replacement')
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('menuitem', { name: '撤销', exact: true }).click()
    await expect(editor).toHaveText('draft one two')
    await page.getByRole('button', { name: '文件', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(editor).toBeFocused()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.getByRole('button', { name: '视图', exact: true }).click()
    await editor.click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await editor.fill('')
    await page.getByRole('button', { name: '切换到全宽阅读', exact: true }).click()
    await page.addStyleTag({ content: '* { transition: none !important; }' })
    const measurements = []
    for (const size of [
      [1440, 920],
      [980, 680]
    ]) {
      for (const zoom of [1, 1.25, 1.5]) {
        const contentSize = await app.evaluate(
          ({ BrowserWindow }, { size, zoom }) => {
            const window = BrowserWindow.getAllWindows()[0]!
            window.setSize(size[0]!, size[1]!)
            window.webContents.setZoomFactor(zoom)
            return window.getContentSize()
          },
          { size, zoom }
        )
        await expect
          .poll(() => page.evaluate(() => innerWidth))
          .toBeCloseTo(Math.round(contentSize[0]! / zoom), -1)
        await expect
          .poll(() => page.evaluate(() => innerHeight))
          .toBeCloseTo(Math.round(contentSize[1]! / zoom), -1)
        await expect
          .poll(() =>
            page.evaluate(() =>
              Math.round(document.querySelector('.app-titlebar')!.getBoundingClientRect().height)
            )
          )
          .toBe(44)
        const dimensions = await page.evaluate(() => {
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
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            bar: rect('.app-titlebar'),
            sidebar: rect('.task-sidebar'),
            content: rect('.conversation-area'),
            messages: rect('.timeline-inner'),
            reading: rect('.timeline'),
            composer: rect('.composer-area'),
            send: rect('.send-button'),
            switcher: rect('.header-actions'),
            overflow: document.documentElement.scrollWidth > innerWidth
          }
        })
        expect(dimensions.overflow).toBe(false)
        expect(dimensions.send.right).toBeLessThanOrEqual(dimensions.viewport.width)
        expect(dimensions.send.bottom).toBeLessThanOrEqual(dimensions.viewport.height)
        expect(dimensions.reading.height).toBeGreaterThan(100)
        expect(dimensions.messages.width).toBeGreaterThan(dimensions.content.width - 70)
        expect(dimensions.switcher.right).toBeLessThanOrEqual(dimensions.viewport.width - 140)
        if (size[0] === 1440 && zoom === 1) expect(dimensions.messages.width).toBeGreaterThan(1000)
        measurements.push({ size, zoom, ...dimensions })
        const png = await app.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
            .toPNG()
            .toString('base64')
        )
        await writeFile(
          resolve(evidence, `layout-${size[0]}-${zoom}.png`),
          Buffer.from(png, 'base64')
        )
      }
    }
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1)
    })
    await page.getByRole('button', { name: '分屏', exact: true }).click()
    await expect(page.locator('.terminal-drawer')).toBeVisible()
    await page.getByRole('button', { name: '直接控制', exact: true }).click()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: '撤销', exact: true })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
    })
    await page.screenshot({ path: resolve(evidence, 'layout-dark.png') })
    await page.evaluate(async () => {
      const settings = await window.claudeBridge.settings.get()
      await window.claudeBridge.settings.update({ ...settings, closeToTray: true })
    })
    await page.getByRole('button', { name: '文件', exact: true }).click()
    await page.getByRole('menuitem', { name: '关闭窗口', exact: true }).click()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())
      )
      .toBe(false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show())
    expect(errors).toEqual([])
    await writeFile(
      resolve(evidence, 'measurements.json'),
      JSON.stringify(
        {
          reference:
            'Historical reference screenshots were removed during release cleanup; their scaling was unknown. These are app measurements, not a same-condition comparison.',
          measurements,
          errors
        },
        null,
        2
      )
    )
  } finally {
    await app.close()
  }
})
