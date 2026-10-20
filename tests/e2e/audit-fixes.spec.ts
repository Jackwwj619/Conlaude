import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

const folder = resolve('playwright-report/audit-fixes')
const target = { profileId: 'mas', sessionName: 'claude-review' }
const resume = (app: import('@playwright/test').ElectronApplication) =>
  app.evaluate(() =>
    (
      globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
    ).resumeOfflineRenderer()
  )

test('settings preserve undo; shortcuts, search, stop, upload and compact targets remain usable', async () => {
  test.setTimeout(90000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `workspace-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await resume(app)
    const page = await app.firstWindow()
    await page.evaluate(() => localStorage.setItem('clb:draft:mas:claude-review', '撤销基线'))
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: target.sessionName }).click()
    const editor = page.locator('.cm-content')
    await expect(editor).toHaveText('撤销基线')
    const original = await editor.elementHandle()
    await editor.press('Control+End')
    await page.keyboard.insertText('-append')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '常规', exact: true }).click()
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US')
    await expect(page.locator('.settings-footer')).toContainText('Saved')
    await page.keyboard.press('Escape')
    await editor.focus()
    await editor.press('Control+z')
    await expect(editor).toHaveText('撤销基线')
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN')
    await expect(page.locator('.settings-footer')).toContainText('已保存')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '设置', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    expect(
      ((await command(app, { type: 'calls' })) as { channel: string }[]).filter(
        (entry) => entry.channel === 'terminal:write-control'
      )
    ).toHaveLength(0)
    await editor.press('Shift+Tab')
    await expect(page.locator('[aria-keyshortcuts="Shift+Tab"]')).toContainText('接受编辑')

    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'repeated-word',
        kind: 'assistant',
        isFinal: true,
        text:
          'auditneedle 第一处\n\n' +
          '上下文内容。\n\n'.repeat(20) +
          'auditneedle 第二处\n\n auditneedle 第三处'
      }
    })
    await expect(page.locator('[data-timeline-id="repeated-word"]')).toBeAttached()
    await page.keyboard.press('Control+f')
    await page.getByRole('searchbox', { name: '搜索当前对话' }).fill('auditneedle')
    await expect(page.locator('.timeline-search')).toContainText('1/3')
    await page.keyboard.press('Enter')
    await expect(page.locator('.timeline-search')).toContainText('2/3')
    await page.keyboard.press('Escape')
    await command(app, { type: 'status', target, status: { generating: true } })
    await page.getByRole('button', { name: '停止生成', exact: true }).click()
    await expect(page.locator('.stop-button')).toHaveCount(0)
    await expect(editor).toHaveText('撤销基线')
    await page.getByRole('button', { name: '上传文件', exact: true }).click()
    await expect(page.locator('.upload-progress')).toContainText('回测报告.csv')
    await command(app, { type: 'upload-done' })
    await expect(editor).toContainText('/srv/uploads/回测报告.csv')
    await expect(page.locator('.composer-destination')).toContainText('mas')
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.setSize(980, 680)
      w.webContents.setZoomFactor(1.5)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700)
    await page.getByRole('button', { name: '分屏', exact: true }).click()
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      send: document.querySelector('.send-button')!.getBoundingClientRect().toJSON(),
      timeline: document.querySelector('.timeline')!.getBoundingClientRect().toJSON()
    }))
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
    )
    await writeFile(resolve(folder, 'compact.png'), Buffer.from(png, 'base64'))
    await writeFile(resolve(folder, 'compact-bounds.json'), JSON.stringify(bounds, null, 2))
    expect(bounds.send.right).toBeLessThanOrEqual(bounds.width + 1)
    expect(bounds.send.bottom).toBeLessThanOrEqual(bounds.height + 1)
    expect(bounds.timeline.height).toBeGreaterThan(100)
  } finally {
    await app.close()
  }
})

test('new installations start empty and failed diagnostics still export a safe complete snapshot', async () => {
  test.setTimeout(60000)
  const data = resolve(folder, `diagnostics-${Date.now()}`)
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: data }
  })
  try {
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            typeof (globalThis as unknown as { resumeOfflineRenderer: unknown })
              .resumeOfflineRenderer
        )
      )
      .toBe('function')
    await resume(app)
    const page = await app.firstWindow()
    await expect(page.locator('.server-library')).toBeVisible()
    await expect(page.locator('.server-card')).toHaveCount(0)
    const config = {
      ...DEFAULT_SETTINGS,
      profiles: [
        {
          ...DEFAULT_SETTINGS.profiles[0]!,
          id: 'local-audit',
          label: '诊断测试',
          sshHost: undefined,
          host: '127.0.0.1',
          user: 'private-audit-user',
          port: 1
        }
      ],
      currentProfileId: 'local-audit'
    }
    await page.evaluate((settings) => window.claudeBridge.settings.update(settings), config)
    await page.reload()
    const destination = resolve(data, 'export.json')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, destination)
    await page.getByRole('button', { name: '连接诊断', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新检查', exact: true })).toBeDisabled()
    await expect(page.locator('.diagnostic-item')).toHaveCount(6, { timeout: 30000 })
    await expect(page.locator('.diagnostic-item.skipped')).toHaveCount(2)
    await page.getByRole('button', { name: '导出报告', exact: true }).click()
    await expect
      .poll(async () => readFile(destination, 'utf8').catch(() => ''))
      .toContain('generatedAt')
    const output = await readFile(destination, 'utf8')
    expect(output).not.toContain('127.0.0.1')
    expect(output).not.toContain('private-audit-user')
    expect(JSON.parse(output).checks).toHaveLength(6)
    await expect(page.getByText('脱敏诊断报告已导出。')).toBeVisible()
  } finally {
    await app.close()
  }
})
