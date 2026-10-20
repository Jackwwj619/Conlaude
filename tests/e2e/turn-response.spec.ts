import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import type { TimelineEvent } from '../../src/shared/contracts'
import { IPC } from '../../src/shared/ipc'

const folder = resolve('playwright-report/turn-response')
const target = { profileId: 'mas', sessionName: 'claude-review' }
async function capture(app: ElectronApplication, name: string) {
  const page = await app.firstWindow()
  await page
    .locator('.turn-response')
    .last()
    .evaluate((node) => node.scrollIntoView({ block: 'end' }))
  await page.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getTiming().iterations === Infinity) continue
      try {
        animation.finish()
      } catch {
        /* Pending animation. */
      }
    }
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done()))
    )
  })
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
  )
  await writeFile(resolve(folder, `${name}.png`), Buffer.from(png, 'base64'))
}

test('request timing, foldable progress and service errors follow each conversation turn', async () => {
  test.setTimeout(90000)
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `profile-${Date.now()}`)
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
    const emit = async (event: TimelineEvent) => {
      await command(app, { type: 'event', target, event })
    }
    await page.locator('.cm-content').fill('核对这轮结果，并解释处理过程。')
    await page.locator('.send-button').click()
    const current = page.locator('.turn-response').last()
    await expect(current).toHaveAttribute('data-turn-state', 'working')
    await expect(current.locator('.turn-summary')).toContainText('正在处理')
    await expect(current.locator('.turn-summary')).toContainText(/[1-9]\d*s/, { timeout: 5000 })
    await command(app, { type: 'send-done' })
    await emit({
      id: 'progress',
      kind: 'assistant',
      isFinal: false,
      text: '我会先核对数据，再对比手续费与滑点假设。'
    })
    await emit({
      id: 'read-tool',
      kind: 'tool-use',
      toolCallId: 'read',
      toolName: 'Read',
      toolInput: { file_path: 'reports/backtest.csv' }
    })
    await emit({
      id: 'read-result',
      kind: 'tool-result',
      toolCallId: 'read',
      toolResult: '数据完整，已识别 12 个高换手区间。'
    })
    await emit({
      id: 'retry',
      kind: 'error',
      text: 'API Error: 503 upstream unavailable',
      responseError: { code: '503', retrying: true, retryAfterMs: 2000, attempt: 1 }
    })
    await expect(current.locator('.response-problem')).toContainText('503')
    await expect(current.locator('.response-problem')).toContainText('正在重试')
    await expect(current.locator('.turn-activity')).not.toHaveAttribute('open')
    await capture(app, 'retry-light')
    await emit({
      id: 'final-turn',
      kind: 'assistant',
      isFinal: true,
      text: '已完成核对。收益偏差主要来自高换手区间的交易成本。\n\n建议统一手续费与滑点参数后再进行对比，原始数据和时间对齐均正常。'
    })
    await expect(current).toHaveAttribute('data-turn-state', 'completed')
    await expect(current.locator('.turn-summary')).toContainText('耗时')
    await expect(current.locator('.response-problem')).toHaveCount(0)
    await expect(
      current.getByText('已完成核对。收益偏差主要来自高换手区间的交易成本。')
    ).toBeVisible()
    const duration = await current.locator('.turn-summary').textContent()
    await current.locator('.turn-summary').click()
    await expect(current.getByText('我会先核对数据，再对比手续费与滑点假设。')).toBeVisible()
    await current.locator('.turn-summary').press('Enter')
    await expect(current.getByText('我会先核对数据，再对比手续费与滑点假设。')).toHaveCount(0)
    await page.locator('.session-entry').filter({ hasText: 'claude-check' }).click()
    await page.locator('.session-entry[title*="claude-review"]').click()
    await expect(current.locator('.turn-summary')).toHaveText(duration!)
    await page.keyboard.press('Control+f')
    await page.getByRole('searchbox').fill('先核对数据')
    await expect(current.getByText('我会先核对数据，再对比手续费与滑点假设。')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(current.locator('.turn-activity')).not.toHaveAttribute('open')

    await emit({
      id: 'reference-prompt',
      kind: 'user',
      text: '对话内容的显示宽度改成可配置，同时保留当前的铺满效果。',
      timestamp: '2026-10-05T10:00:00Z'
    })
    await emit({
      id: 'reference-progress',
      kind: 'assistant',
      isFinal: false,
      text: '我会检查阅读宽度、正文与输入框的对齐，并验证小窗口下的布局。',
      timestamp: '2026-10-05T10:00:05Z'
    })
    await emit({
      id: 'reference-tool',
      kind: 'tool-use',
      toolName: 'Edit',
      toolInput: { file_path: 'conversation-layout.css' }
    })
    await emit({
      id: 'reference-final',
      kind: 'assistant',
      isFinal: true,
      text: '已增加对话显示宽度设置：可以选择铺满可用空间，或使用居中的阅读区域，并调整最大宽度。\n\n正文和输入框保持对齐，设置即时生效并保存。小窗口和高缩放下也可以正常阅读。',
      timestamp: '2026-10-05T10:01:28Z'
    })
    await expect(current.locator('.turn-summary')).toHaveText('耗时 1m 28s')
    await capture(app, 'folded-light')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    const document = await cdp.send('DOM.getDocument')
    const fontNode = await cdp.send('DOM.querySelector', {
      nodeId: document.root.nodeId,
      selector: '[data-timeline-id="reference-final"] p'
    })
    await cdp.send('CSS.enable')
    const fonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: fontNode.nodeId })
    await writeFile(resolve(folder, 'fonts.json'), JSON.stringify(fonts, null, 2))
    await cdp.detach()
    await current.locator('.turn-summary').click()
    await capture(app, 'expanded-light')
    await current.locator('.turn-summary').click()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '外观', exact: true }).click()
    await page.getByRole('button', { name: '深色', exact: true }).click()
    await page.keyboard.press('Escape')
    await capture(app, 'folded-dark')
    await current.locator('.turn-summary').click()
    await capture(app, 'expanded-dark')
    await emit({
      id: 'failed-prompt',
      kind: 'user',
      text: '服务暂时不可用时，显示明确的错误原因。',
      timestamp: '2026-10-05T10:02:00Z'
    })
    await emit({
      id: 'failed-response',
      kind: 'error',
      text: 'API Error: 503 service unavailable',
      responseError: { code: '503', retrying: false },
      timestamp: '2026-10-05T10:02:15Z'
    })
    await expect(current.locator('.response-problem')).toContainText('回复未完成')
    await current.locator('.response-error-detail summary').click()
    await expect(current.locator('.response-error-detail pre')).toHaveText(
      'API Error: 503 service unavailable'
    )
    await capture(app, 'error-dark')
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setSize(980, 680)
      win.webContents.setZoomFactor(1.5)
    })
    const card = (await current.locator('.response-problem').boundingBox())!
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await capture(app, 'error-compact')
    await current.getByRole('button', { name: '查看终端', exact: true }).click()
    await expect(page.locator('.terminal-drawer')).toHaveClass(/open/)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('failed sends preserve the draft and an acknowledged stop ends only its own timer', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `fail-stop-${Date.now()}`)
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
    await page.locator('.session-entry[title*="claude-review"]').click()
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => {
        throw new Error('Connection unavailable')
      })
    }, IPC.promptsSend)
    const editor = page.locator('.cm-content')
    await editor.fill('保留这份未发送的草稿。')
    await page.locator('.send-button').click()
    await expect(page.locator('.turn-response').last()).toHaveAttribute('data-turn-state', 'failed')
    await expect(page.locator('.turn-response').last()).toContainText('消息未发送')
    await expect(editor).toHaveText('保留这份未发送的草稿。')
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({ accepted: true }))
    }, IPC.promptsSend)
    await page.locator('.send-button').click()
    await expect(page.locator('.turn-response').last()).toHaveAttribute(
      'data-turn-state',
      'working'
    )
    await command(app, { type: 'status', target, status: { generating: true } })
    await page.locator('.stop-button').click()
    await expect(page.locator('.turn-response').last()).toHaveAttribute(
      'data-turn-state',
      'stopped'
    )
    await expect(page.locator('.turn-response').last().locator('.turn-summary')).toContainText(
      '已停止'
    )
    await expect(page.locator('.turn-response[data-turn-state="failed"]')).toHaveCount(1)
    await expect(page.locator('.composer-state')).toContainText('已停止生成')
    await editor.fill('这条已发送，但服务器无法返回回复。')
    await page.locator('.send-button').click()
    await expect(editor.locator('.cm-placeholder')).toBeVisible()
    await expect(page.locator('.send-button')).toBeDisabled()
    await command(app, {
      type: 'event',
      target,
      event: {
        id: 'server-failure',
        kind: 'error',
        text: 'API Error: 503',
        responseError: { code: '503', retrying: false }
      }
    })
    await expect(page.locator('.composer-state')).toContainText('回复未完成')
    await expect(page.locator('.composer-state')).not.toContainText('草稿已保留')
  } finally {
    await app.close()
  }
})
