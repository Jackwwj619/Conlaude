import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { IPC } from '../../src/shared/ipc'
import type { WriteControlRequest, WriteTerminalInputRequest } from '../../src/shared/contracts'

import { command, fixture } from './workspace-fixture'
const projectRoot = resolve(import.meta.dirname, '..', '..')
const main = { profileId: 'mas', sessionName: 'claude-review' }

test('Shift+Tab uses native mode switching without moving focus or submitting a draft', async () => {
  test.setTimeout(60000)
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(projectRoot, 'test-results', `permission-mode-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const editor = page.locator('.cm-content')
    const mode = page.locator('[aria-keyshortcuts="Shift+Tab"]')
    await expect(mode).toContainText('默认')
    await editor.fill('切换模式时保留的草稿')
    await editor.press('Shift+Tab')
    await expect(mode).toContainText('接受编辑')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText('切换模式时保留的草稿')
    await mode.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(mode).toContainText('接受编辑')
    await expect(mode).not.toBeFocused()
    await mode.click()
    await expect(mode).toContainText('计划')
    await mode.click()
    await expect(mode).toContainText('默认')

    const controls = async () =>
      (
        (await command(app, { type: 'calls' })) as {
          channel: string
          request: WriteControlRequest
        }[]
      ).filter((call) => call.channel === IPC.terminalWriteControl)
    expect(await controls()).toHaveLength(3)
    expect((await controls()).map((call) => call.request.control)).toEqual([
      'shiftTab',
      'shiftTab',
      'shiftTab'
    ])
    expect(
      ((await command(app, { type: 'calls' })) as { channel: string }[]).some(
        (call) => call.channel === IPC.promptsSend
      )
    ).toBe(false)

    await page.getByRole('button', { name: '分屏', exact: true }).click()
    await page.getByRole('button', { name: '直接控制', exact: true }).click()
    await expect(page.locator('.xterm-helper-textarea')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(mode).toContainText('接受编辑')
    expect(await controls()).toHaveLength(3)
    const directInput = (
      (await command(app, { type: 'calls' })) as {
        channel: string
        request: WriteTerminalInputRequest
      }[]
    ).filter((call) => call.channel === IPC.terminalWriteInput)
    expect(directInput).toHaveLength(1)
    expect(directInput[0]!.request.data).toBe('\u001b[Z')
    await page.getByRole('button', { name: '直接控制已开启', exact: true }).click()

    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.keyboard.press('Shift+Tab')
    expect(await controls()).toHaveLength(3)
    await page.keyboard.press('Escape')
    await command(app, { type: 'status', target: main, status: { readOnly: true } })
    await expect(mode).toBeDisabled()
    await editor.press('Shift+Tab')
    expect(await controls()).toHaveLength(3)
    await command(app, { type: 'status', target: main, status: { readOnly: false } })
    await page.getByRole('button', { name: '管理服务器', exact: true }).click()
    await page.keyboard.press('Shift+Tab')
    expect(await controls()).toHaveLength(3)
  } finally {
    await app.close()
  }
})

test('workspace navigation, drafts, confirmations and responsive views use the real renderer', async () => {
  test.setTimeout(120000)
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(projectRoot, 'test-results', `workspace-ux-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await fixture(app)
    await page.reload()
    await page.setViewportSize({ width: 1440, height: 940 })
    await expect(page.locator('.server-library')).toBeVisible()
    await expect(page.locator('.server-cards')).toHaveClass(/list/)
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await expect(page.locator('.connection-label')).toHaveAccessibleName('已连接')
    await expect(page.locator('.workspace-header h1')).toHaveText('claude-review')
    await expect(page.getByRole('button', { name: '终止远端会话…', exact: true })).toBeHidden()
    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '修改标题', exact: true }).click()
    await page.getByRole('textbox', { name: '会话标题' }).fill('检查回测结果')
    await page.getByRole('dialog').getByRole('button', { name: '保存标题' }).click()
    await expect(page.locator('.workspace-header h1')).toHaveText('claude-review')
    await expect(page.locator('.session-entry.selected')).toContainText('检查回测结果')
    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '置顶会话', exact: true }).click()
    await expect(page.locator('.session-entry').first()).toContainText('检查回测结果')
    await page.screenshot({
      path: 'playwright-report/ux-iteration/workspace-overview.png',
      animations: 'disabled'
    })

    const editor = page.locator('.cm-content')
    await editor.fill('第一行草稿')
    await editor.press('Enter')
    await page.keyboard.insertText('第二行')
    await expect(editor.locator('.cm-line')).toHaveCount(2)
    await editor.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      isComposing: true
    })
    const calls = () =>
      command(app, { type: 'calls' }) as Promise<
        { channel: string; request: Record<string, unknown> }[]
      >
    expect((await calls()).filter((call) => call.channel === IPC.promptsSend)).toHaveLength(0)
    await editor.press('Control+Enter')
    await expect
      .poll(async () => (await calls()).filter((call) => call.channel === IPC.promptsSend).length)
      .toBe(1)
    await editor.fill('发送期间继续编辑的新草稿')
    await command(app, { type: 'send-done' })
    await expect(page.locator('.composer-feedback')).toContainText('编辑已保留')
    await expect(editor).toHaveText('发送期间继续编辑的新草稿')

    await page.getByRole('button', { name: 'Experiments · exp', exact: true }).click()
    await page
      .locator('.project-group')
      .filter({ hasText: 'Experiments' })
      .locator('.session-entry')
      .filter({ hasText: 'claude-review' })
      .click()
    await expect(editor.locator('.cm-placeholder')).toBeVisible()
    await editor.fill('EXP 独立草稿')
    await page.locator('.session-entry').filter({ hasText: '检查回测结果' }).click()
    await expect(editor).toHaveText('发送期间继续编辑的新草稿')
    await page.getByRole('button', { name: /上传文件/ }).click()
    await expect(page.locator('.composer-feedback')).toContainText('正在上传')
    await page
      .locator('.project-group')
      .filter({ hasText: 'Experiments' })
      .locator('.session-entry')
      .filter({ hasText: 'claude-review' })
      .click()
    await command(app, { type: 'upload-done' })
    await expect(editor).toHaveText('EXP 独立草稿')
    await page.locator('.session-entry').filter({ hasText: '检查回测结果' }).click()
    await expect(editor).toContainText('/srv/uploads/回测报告.csv')

    await command(app, {
      type: 'status',
      target: main,
      status: { promptState: 'confirmation', promptMessage: 'Claude 正在等待你的确认。' }
    })
    await expect(page.locator('.workspace-notice')).toContainText('需要终端确认')
    await expect(page.locator('.send-button')).toBeDisabled()
    await page
      .locator('.workspace-notice')
      .getByRole('button', { name: '查看终端', exact: true })
      .click()
    await expect(page.locator('.app-shell')).toHaveClass(/workspace-mode-split/)
    expect(
      (await calls()).filter((call) => call.channel === IPC.terminalWriteControl)
    ).toHaveLength(0)
    await page.screenshot({
      path: 'playwright-report/ux-iteration/confirmation-split.png',
      animations: 'disabled'
    })
    await command(app, { type: 'status', target: main, status: { state: 'reconnecting' } })
    await expect(page.locator('.workspace-notice')).toContainText('正在重连')
    await expect(editor).toContainText('/srv/uploads/回测报告.csv')
    expect((await calls()).filter((call) => call.channel === IPC.promptsSend)).toHaveLength(1)
    await command(app, { type: 'status', target: main })

    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '以只读方式打开' }).click()
    await expect(page.locator('.workspace-notice')).toContainText('只读观察')
    await expect(page.locator('.send-button')).toBeDisabled()
    await page.getByRole('button', { name: '切换为可交互' }).click()
    await expect(page.locator('.send-button')).toBeEnabled()
    const attached = (await calls()).filter((call) => call.channel === IPC.sessionsAttach)
    expect(attached.filter((call) => call.request.profileId === 'mas')).toHaveLength(3)
    expect(attached.every((call) => call.request.detachOtherClients === false)).toBe(true)

    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.screenshot({
      path: 'playwright-report/ux-iteration/conversation-light.png',
      animations: 'disabled'
    })
    await page.getByRole('button', { name: '切换到深色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({
      path: 'playwright-report/ux-iteration/conversation-dark.png',
      animations: 'disabled'
    })
    await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.getByRole('button', { name: '分屏', exact: true }).click()
    await page.screenshot({
      path: 'playwright-report/ux-iteration/compact-split.png',
      animations: 'disabled'
    })
    for (const selector of [
      '.send-button',
      '.workspace-header',
      '.composer-shell',
      '.status-bar'
    ]) {
      const box = await page.locator(selector).boundingBox()
      expect(box, selector).toBeTruthy()
      expect(box!.x, selector).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, selector).toBeLessThanOrEqual(1001)
      expect(box!.y + box!.height, selector).toBeLessThanOrEqual(701)
    }
    await page.keyboard.press('Control+k')
    await expect(page.getByRole('textbox', { name: '搜索项目或会话…' })).toBeFocused()
    await page.keyboard.insertText('检查回测')
    await expect(page.locator('.session-entry:visible')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '折叠侧边栏' }).click()
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
    await page.reload()
    await expect(page.locator('.workspace-header h1')).toHaveText('claude-review')
    await expect(page.locator('.session-entry.selected')).toContainText('检查回测结果')
    await expect(page.locator('.connection-label')).toHaveAccessibleName('已连接')
    await expect(editor).toContainText('/srv/uploads/回测报告.csv')
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
    await page.locator('[aria-controls="workspace-sidebar"]').click()
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 940 })
    await page.getByRole('button', { name: '管理服务器', exact: true }).click()
    await page.screenshot({
      path: 'playwright-report/ux-iteration/server-library.png',
      animations: 'disabled'
    })
    expect(errors).toEqual([])
    expect((await calls()).some((call) => call.channel === IPC.sessionsTerminate)).toBe(false)
  } finally {
    await app.close()
  }
})

test('reading position, readonly restore, creation and termination stay predictable', async () => {
  test.setTimeout(90000)
  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(projectRoot, 'test-results', `workspace-lifecycle-${Date.now()}`)
    }
  })
  try {
    const page = await app.firstWindow()
    await fixture(app)
    await page.reload()
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await expect(page.locator('.connection-label')).toHaveAccessibleName('已连接')
    const longReply = Array.from(
      { length: 40 },
      (_, i) => `第 ${i + 1} 段：保留用户正在阅读的位置。`
    ).join('\n\n')
    await command(app, {
      type: 'event',
      target: main,
      event: { id: 'long-reply', kind: 'assistant', text: longReply }
    })
    const timeline = page.locator('.timeline')
    await expect(page.locator('[data-timeline-id="long-reply"]')).toBeAttached()
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop))
      .toBeLessThan(25)
    await timeline.evaluate((e) => {
      e.scrollTop = 120
      e.dispatchEvent(new Event('scroll'))
    })
    await expect.poll(() => timeline.evaluate((e) => e.scrollTop)).toBe(120)
    await page.locator('.session-entry').filter({ hasText: 'claude-check' }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    await expect.poll(() => timeline.evaluate((e) => e.scrollTop)).toBe(120)
    await command(app, {
      type: 'event',
      target: main,
      event: { id: 'extra', kind: 'assistant', text: '新的输出内容' }
    })
    await expect(page.getByRole('button', { name: '跳至最新' })).toContainText('有新内容')
    expect(await timeline.evaluate((e) => e.scrollTop)).toBe(120)
    await page.getByRole('button', { name: '跳至最新' }).click()
    await expect
      .poll(() => timeline.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop))
      .toBeLessThan(25)
    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '以只读方式打开' }).click()
    await expect(page.locator('.workspace-notice')).toContainText('只读观察')
    await page.reload()
    await expect(page.locator('.workspace-notice')).toContainText('只读观察')
    await expect(page.locator('.send-button')).toBeDisabled()
    await page.locator('.new-session-button').click()
    const create = page.getByRole('dialog', { name: '新建 Claude 会话' })
    await create.getByLabel('会话标题', { exact: true }).fill('新建测试工作')
    await expect(create.getByLabel('tmux 会话名', { exact: true })).toBeVisible()
    await create.getByRole('button', { name: '创建并连接' }).click()
    await expect(create).toBeHidden()
    await expect(page.locator('.workspace-header h1')).toHaveText(/^claude-mas-[a-z0-9]+$/)
    await expect(page.locator('.session-entry.selected')).toContainText('新建测试工作')
    await expect(page.locator('.connection-label')).toHaveAccessibleName('已连接')
    const calls = (await command(app, { type: 'calls' })) as {
      channel: string
      request: Record<string, string>
    }[]
    const created = calls.find((item) => item.channel === IPC.sessionsCreate)!.request
    expect(created.cwd).toBe(DEFAULT_SETTINGS.profiles[0]!.defaultCwd)
    expect(created.sessionName).toMatch(/^claude-mas-[a-z0-9]+$/)

    for (const factor of [1.25, 1.5]) {
      await app.evaluate(
        ({ BrowserWindow }, zoom) =>
          BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(zoom),
        factor
      )
      await page.getByRole('button', { name: '分屏', exact: true }).click()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      const button = await page.locator('.send-button').boundingBox()
      expect(button!.y + button!.height).toBeLessThanOrEqual(viewport.height)
      expect(button!.x + button!.width).toBeLessThanOrEqual(viewport.width)
      await page.screenshot({
        path: `playwright-report/ux-iteration/zoom-${factor}.png`,
        animations: 'disabled'
      })
    }
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1)
    )
    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '终止远端会话…' }).click()
    const terminate = page.getByRole('dialog', { name: '终止远端会话' })
    const submit = terminate.getByRole('button', { name: '终止远端会话', exact: true })
    await expect(submit).toBeDisabled()
    await terminate.getByRole('textbox').fill('not-the-target')
    await expect(submit).toBeDisabled()
    await terminate.getByRole('textbox').fill(created.sessionName!)
    await submit.click()
    await expect(terminate).toBeHidden()
    await expect(page.locator('.session-entry').filter({ hasText: '新建测试工作' })).toHaveCount(0)
    await expect(page.locator('.workspace-welcome')).toBeVisible()
    await expect(page.locator('.send-button')).toBeDisabled()
  } finally {
    await app.close()
  }
})
