import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { IPC } from '../../src/shared/ipc'
import { command, fixture } from './workspace-fixture'

const folder = resolve('playwright-report/sidebar-refinement')
const target = { profileId: 'mas', sessionName: 'claude-review' }

test('sidebar folds independently and keeps matching controls aligned through its transition', async () => {
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `layout-${Date.now()}`)
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
    const sidebar = page.locator('.task-sidebar')
    const server = sidebar.getByRole('button', { name: 'project · mas', exact: true })
    await server.click()
    await expect(page.locator('.library-frame')).toBeVisible()
    await expect(server).toHaveAttribute('aria-expanded', 'true')
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await page.locator('.cm-content').fill('折叠服务器也不能切换这个草稿')
    const before = (await command(app, { type: 'calls' })) as { channel: string }[]
    const other = sidebar.getByRole('button', { name: 'Experiments · exp', exact: true })
    await other.click()
    await expect(other).toHaveAttribute('aria-expanded', 'true')
    await expect(other.locator('.server-fold-indicator')).toHaveCSS(
      'transform',
      'matrix(0, 1, -1, 0, 0, 0)'
    )
    await other.click()
    await expect(other).toHaveAttribute('aria-expanded', 'false')
    await server.click()
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.workspace-title h1')).toHaveText('claude-review')
    await expect(page.locator('.cm-content')).toHaveText('折叠服务器也不能切换这个草稿')
    const after = (await command(app, { type: 'calls' })) as { channel: string }[]
    expect(after.filter((call) => call.channel === IPC.sessionsAttach)).toHaveLength(
      before.filter((call) => call.channel === IPC.sessionsAttach).length
    )
    await server.click()
    await page.locator('.session-entry.selected').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '修改标题', exact: true }).click()
    await page.getByRole('textbox', { name: '会话标题', exact: true }).fill('本地显示标题')
    await page.getByRole('textbox', { name: '会话标题', exact: true }).press('Enter')
    await expect(page.locator('.session-entry.selected')).toContainText('本地显示标题')
    await expect(page.locator('.workspace-title h1')).toHaveText('本地显示标题')
    const expanded = await sidebar.evaluate((root) => {
      const selectors = [
        '.brand',
        '.new-session-button',
        '.sidebar-search',
        '.sidebar-footer-button'
      ]
      return selectors.flatMap((selector) =>
        [...root.querySelectorAll(selector)].map((el) => ({
          y: el.getBoundingClientRect().y,
          height: el.getBoundingClientRect().height
        }))
      )
    })
    expect(expanded.map((box) => box.height)).toEqual([32, 36, 36, 36, 36, 36])
    await expect(server).toHaveCSS('min-height', '39px')
    await expect(page.locator('.session-entry.selected')).toHaveCSS('min-height', '32px')
    await expect(sidebar.locator('.brand strong')).toHaveCSS('font-size', '17px')
    await expect(page.locator('.workspace-endpoint')).toHaveCSS('font-size', '13px')
    await command(app, { type: 'status', target, status: { generating: true } })
    const widths = await page.evaluate(async () => {
      document.querySelector<HTMLButtonElement>('.sidebar-close')!.click()
      const widths: number[] = []
      for (let frame = 0; frame < 20; frame++) {
        await new Promise(requestAnimationFrame)
        widths.push(document.querySelector('.task-sidebar')!.getBoundingClientRect().width)
      }
      return widths
    })
    expect(widths.some((width) => width > 65 && width < 250)).toBe(true)
    const rail = page.locator('.sidebar-rail')
    const collapsed = await rail.evaluate((root) =>
      [...root.querySelectorAll(':scope > button, .sidebar-rail-footer > button')].map((el) => ({
        y: el.getBoundingClientRect().y,
        height: el.getBoundingClientRect().height
      }))
    )
    expect(collapsed.map((box) => box.height)).toEqual(expanded.map((box) => box.height))
    collapsed.forEach((box, index) => expect(Math.abs(box.y - expanded[index]!.y)).toBeLessThan(1))
    await expect(rail.locator('.rail-chat-status')).toHaveCount(1)
    await expect(
      rail.getByRole('img', { name: '本地显示标题 · 正在生成', exact: true })
    ).toBeVisible()
    await expect(rail.locator('.rail-server-button')).toHaveCount(0)
    await command(app, {
      type: 'status',
      target,
      status: { generating: false, promptState: 'confirmation' }
    })
    await expect(rail.getByRole('img', { name: /本地显示标题.*确认/ })).toBeVisible()
    await rail.locator('.sidebar-rail-brand').hover()
    await page.screenshot({ path: resolve(folder, 'collapsed-light.png') })
    await rail.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('.settings-modal').getByRole('button', { name: '外观', exact: true }).click()
    await page.locator('.settings-modal').getByRole('button', { name: '深色', exact: true }).click()
    await page.keyboard.press('Escape')
    await rail.locator('.sidebar-rail-brand').hover()
    await page.screenshot({ path: resolve(folder, 'collapsed-dark.png') })
    await rail.locator('.sidebar-rail-brand').click()
    await expect(page.locator('.sidebar-close')).toBeFocused()
    await expect(page.locator('.cm-content')).toHaveText('折叠服务器也不能切换这个草稿')
    await page.screenshot({ path: resolve(folder, 'expanded-dark.png') })
  } finally {
    await app.close()
  }
})

test('notices dismiss for one occurrence, stop replaces send, and status updates stay compact', async () => {
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `notices-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({ installed: false, version: '1.2.0' }))
    }, IPC.helperStatus)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const notice = page.locator('.workspace-notice').filter({ hasText: '真实终端已经可用' })
    await expect(notice).toBeVisible()
    await notice.getByRole('button', { name: '关闭此提示' }).click()
    await expect(notice).toHaveCount(0)
    await page.locator('.cm-content').fill('保留下一条草稿')
    const sendBox = (await page.locator('.send-button').boundingBox())!
    await command(app, { type: 'status', target, status: { generating: true } })
    await expect(page.locator('.send-button')).toHaveCount(0)
    const stopBox = (await page.locator('.stop-button').boundingBox())!
    expect(stopBox.x).toBeCloseTo(sendBox.x, 0)
    expect(stopBox.y).toBeCloseTo(sendBox.y, 0)
    expect(stopBox.width).toBe(sendBox.width)
    expect(stopBox.height).toBe(sendBox.height)
    await expect(notice).toHaveCount(0)
    await page.locator('.stop-button').click()
    const calls = (await command(app, { type: 'calls' })) as { channel: string; request: unknown }[]
    expect(
      calls.filter((call) => call.channel === IPC.promptsInterrupt).map((call) => call.request)
    ).toContainEqual(target)
    await command(app, { type: 'status', target, status: { generating: false } })
    await expect(page.locator('.send-button')).toBeVisible()
    await expect(page.locator('.stop-button')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toHaveText('保留下一条草稿')
    await command(app, { type: 'status', target, status: { state: 'reconnecting' } })
    await command(app, { type: 'status', target, status: { state: 'attached' } })
    await expect(notice).toBeVisible()
    await notice.getByRole('button', { name: '关闭此提示' }).click()
    await page.reload()
    await expect(notice).toBeVisible()
    await command(app, {
      type: 'event',
      target,
      event: { id: 'compact-status', kind: 'status', text: '状态更新' }
    })
    await page.locator('.turn-summary').last().click()
    const status = page.locator('.activity-status').filter({ hasText: '状态更新' }).last()
    await expect(status).toHaveText('状态更新')
    expect((await status.boundingBox())!.height).toBeLessThanOrEqual(32)
    await command(app, {
      type: 'event',
      target,
      event: { id: 'compact-detail', kind: 'status', text: '正在整理检查结果。' }
    })
    await expect(page.locator('.activity-status .markdown-content').last()).toHaveCSS(
      'font-size',
      '12px'
    )
    await page.screenshot({ path: resolve(folder, 'notice-and-status.png') })
  } finally {
    await app.close()
  }
})
