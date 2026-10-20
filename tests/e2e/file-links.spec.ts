import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { fixture, command } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('file tabs preserve separate drafts, reuse open documents and keep their original server', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_TEST_HIDDEN: '1',
      CLB_USER_DATA_DIR: resolve(`test-results/file-tabs-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      const state = globalThis as unknown as { fileReads: unknown[]; fileSaves: unknown[] }
      state.fileReads = []
      state.fileSaves = []
      ipcMain.removeHandler(channels.sessionsAttach)
      ipcMain.handle(channels.sessionsAttach, (_event, request) => ({
        ...request,
        state: 'attached',
        attempt: 0,
        changedAt: Date.now(),
        promptState: 'ready'
      }))
      ipcMain.removeHandler(channels.filesList)
      ipcMain.handle(channels.filesList, (_event, request) => ({
        path: request.path,
        parent: '/',
        truncated: false,
        entries: ['one.md', 'two.md'].map((name) => ({
          name,
          path: `${request.path}/${name}`,
          kind: 'file',
          size: 30,
          modified: 0
        }))
      }))
      ipcMain.removeHandler(channels.filesRead)
      ipcMain.handle(channels.filesRead, (_event, request) => {
        state.fileReads.push(request)
        return {
          path: request.path,
          content: `# ${request.profileId}\n\n${request.path}`,
          version: 'a'.repeat(64),
          writable: true,
          lineEnding: 'LF'
        }
      })
      ipcMain.removeHandler(channels.filesSave)
      ipcMain.handle(channels.filesSave, (_event, request) => {
        state.fileSaves.push(request)
        return { ...request, version: 'b'.repeat(64), writable: true, lineEnding: 'LF' }
      })
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).click()
    const sendLinks = async (profileId: string) =>
      command(app, {
        type: 'event',
        target: { profileId, sessionName: 'claude-review' },
        event: {
          id: `links-${profileId}`,
          kind: 'assistant',
          isFinal: true,
          text: '[First](/srv/one.md) [Second](/srv/two.md)'
        }
      })
    await expect(page.locator('.timeline.empty-state .brand-logo')).toBeVisible()
    await expect(page.locator('.timeline.empty-state .brand-logo')).toHaveAttribute(
      'alt',
      'Conlaude'
    )
    await sendLinks('mas')
    const chat = page.locator('.timeline')
    const panel = page.locator('#remote-files-panel')
    const editor = panel.getByRole('textbox', { name: '文件内容' })
    await chat.getByRole('button', { name: 'First', exact: true }).click()
    await panel.getByRole('button', { name: '编辑', exact: true }).click()
    await editor.fill('first draft')
    await chat.getByRole('button', { name: 'Second', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await panel.getByRole('button', { name: '编辑', exact: true }).click()
    await editor.fill('second draft')
    await page.getByRole('tab', { name: 'one.md', exact: true }).click()
    await expect(editor).toHaveValue('first draft')
    await chat.getByRole('button', { name: 'Second', exact: true }).click()
    await expect(editor).toHaveValue('second draft')
    await expect(page.getByRole('tab', { name: 'two.md', exact: true })).toHaveCount(1)
    await page.getByRole('button', { name: '关闭 one.md', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '尚有未保存内容' })).toBeVisible()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(editor).toHaveValue('second draft')
    await page.getByRole('tab', { name: 'two.md', exact: true }).press('ArrowRight')
    await expect(page.getByRole('tab', { name: 'one.md', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(editor).toHaveValue('first draft')
    await page.getByRole('button', { name: 'Experiments · exp', exact: true }).click()
    await page.locator('.session-entry').filter({ hasText: 'claude-review' }).last().click()
    await sendLinks('exp')
    await chat.getByRole('button', { name: 'First', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'one.md', exact: true })).toHaveCount(2)
    await expect(panel.getByRole('heading', { name: 'exp', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'one.md', exact: true }).first().click()
    await expect(editor).toHaveValue('first draft')
    await editor.press('Control+s')
    await expect(panel.getByText('已保存')).toBeVisible()
    const calls = await app.evaluate(() => {
      const state = globalThis as unknown as {
        fileReads: { profileId: string; path: string }[]
        fileSaves: { profileId: string; path: string; content: string }[]
      }
      return { reads: state.fileReads, saves: state.fileSaves }
    })
    expect(calls.reads.map(({ profileId, path }) => [profileId, path])).toEqual([
      ['mas', '/srv/one.md'],
      ['mas', '/srv/two.md'],
      ['exp', '/srv/one.md']
    ])
    expect(calls.saves).toEqual([
      expect.objectContaining({ profileId: 'mas', path: '/srv/one.md', content: 'first draft' })
    ])
    await page.getByRole('button', { name: '关闭 two.md', exact: true }).click()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'two.md', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '关闭 one.md', exact: true }).last().click()
    await expect(page.getByRole('tab', { name: 'one.md', exact: true })).toHaveCount(1)
    await expect(editor).toHaveValue('first draft')
    await command(app, {
      type: 'event',
      target: { profileId: 'exp', sessionName: 'claude-review' },
      event: {
        id: 'many-files',
        kind: 'assistant',
        isFinal: true,
        text: Array.from({ length: 8 }, (_, i) => `[Extra${i}](/srv/extra-${i}.md)`).join(' ')
      }
    })
    const tabs = page.locator('.dock-tabs')
    const initialHeight = (await tabs.boundingBox())!.height
    for (let i = 0; i < 8; i++)
      await chat.getByRole('button', { name: `Extra${i}`, exact: true }).click()
    expect((await tabs.boundingBox())!.height).toBeCloseTo(initialHeight, 1)
    expect(
      await tabs.evaluate((el) => Math.abs(el.clientHeight - el.getBoundingClientRect().height))
    ).toBeLessThan(1)
    await expect(tabs).toHaveCSS('scrollbar-width', 'none')
    await expect(tabs.getByRole('tab', { name: '终端', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: 'extra-7.md', exact: true }).press('Home')
    await expect(editor).toHaveValue('first draft')
    const rail = (await page.locator('.panel-tool-rail').boundingBox())!
    expect(rail.x + rail.width).toBeCloseTo(await page.evaluate(() => innerWidth), 0)
    await page.screenshot({ path: 'playwright-report/file-tabs-rail.png' })
  } finally {
    await app.close()
  }
})
