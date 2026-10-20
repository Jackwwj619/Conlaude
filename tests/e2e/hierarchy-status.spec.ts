import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SessionStatus } from '../../src/shared/contracts'
import { command, fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'

test('server disclosure preserves folder folds, active sessions and saved layout', async () => {
  const folder = resolve('playwright-report/hierarchy-status')
  await mkdir(folder, { recursive: true })
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `fold-${Date.now()}`)
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
    const server = page.getByRole('button', { name: 'project · mas', exact: true })
    const project = page.getByRole('button', { name: 'project', exact: true })
    const target = { profileId: 'mas', sessionName: 'claude-review' }
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await expect(server.locator('.sidebar-server-icon .lucide-server')).toBeVisible()
    await expect(server.locator('.server-fold-indicator')).toBeVisible()
    await server.click({ position: { x: 150, y: 14 } })
    await expect(server).toHaveAttribute('aria-expanded', 'true')
    await page.locator('.session-entry[title*="claude-review"]').click()
    await page.locator('.cm-content').fill('Keep this draft while the server is folded')
    await command(app, { type: 'status', target, status: { generating: true } })
    const connectionCalls = async () =>
      ((await command(app, { type: 'calls' })) as { channel: string }[]).filter((call) =>
        [IPC.sessionsList, IPC.sessionsAttach, IPC.sessionsDetach].some(
          (channel) => channel === call.channel
        )
      ).length
    const beforeFold = await connectionCalls()
    await project.click()
    await server.click()
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await expect(project).toBeHidden()
    await expect(page.locator('.session-entry.selected')).toBeHidden()
    await expect(page.locator('.composer-state')).toContainText('正在生成')
    await expect(page.locator('.cm-content')).toHaveText(
      'Keep this draft while the server is folded'
    )
    await server.press('ArrowRight')
    await expect(project).toBeVisible()
    await expect(project).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.session-entry.selected')).toBeHidden()
    await server.press('ArrowLeft')
    await server.press('Tab')
    await expect(server.locator('+ .session-row-actions > .server-new-session')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(
      server.locator('+ .session-row-actions > button[aria-haspopup="menu"]')
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Experiments · exp', exact: true })).toBeFocused()
    const search = page.locator('.sidebar-search input')
    await search.fill('claude-review')
    await expect(server).toHaveAttribute('aria-expanded', 'true')
    await expect(project).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.session-entry.selected')).toBeVisible()
    await search.fill('')
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await expect(project).toBeHidden()
    expect(await connectionCalls()).toBe(beforeFold)
    await page.reload()
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await server.press('ArrowRight')
    await expect(project).toHaveAttribute('aria-expanded', 'false')
    await project.press('ArrowRight')
    await expect(page.locator('.session-entry.selected')).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(
      'Keep this draft while the server is folded'
    )
    await server.press(' ')
    await expect(server).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#server-projects-mas')).toBeHidden()
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64')
    )
    await writeFile(resolve(folder, 'server-folded.png'), Buffer.from(png, 'base64'))
  } finally {
    await app.close()
  }
})

test('sidebar preserves hierarchy and stable rows while status icons remain legible on the right', async () => {
  test.setTimeout(90000)
  const folder = resolve('playwright-report/hierarchy-status')
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
    await page.getByRole('button', { name: 'project · mas', exact: true }).click()
    await page.locator('.session-entry[title*="claude-review"]').click()
    const target = { profileId: 'mas', sessionName: 'claude-review' }
    const selected = page.locator('.session-entry.selected')
    const icon = selected.locator('.session-status-icon')
    await expect(page.locator('.workspace-context')).toHaveCSS('-webkit-app-region', 'no-drag')
    const sessionTitle = await selected.locator('strong').innerText()
    const baseline = (await selected.boundingBox())!.height
    const cases: [Partial<SessionStatus>, string][] = [
      [{ state: 'checking' }, '检查中'],
      [{ state: 'connecting' }, '连接中'],
      [{ state: 'reconnecting' }, '正在重连'],
      [{ state: 'failed' }, '连接失败'],
      [{ state: 'detached' }, '已分离'],
      [{ readOnly: true }, '只读观察'],
      [{ promptState: 'confirmation' }, '需要终端确认'],
      [{ promptState: 'checking' }, '正在确认输入状态'],
      [{ generating: true }, '正在生成'],
      [{}, '已收到回复']
    ]
    for (const [status, label] of cases) {
      await command(app, { type: 'status', target, status })
      await expect(icon).toHaveAccessibleName(label)
      await expect(icon).toHaveAttribute('title', label)
      await expect(selected).toHaveAccessibleName(`${sessionTitle} · ${label}`)
      // Transitions must not insert another text line or move the next session.
      expect((await selected.boundingBox())!.height).toBeCloseTo(baseline, 1)
      await expect(selected).not.toContainText(label)
      await expect(icon.locator('svg')).toBeVisible()
    }
    const hierarchy = await page.evaluate(() => {
      const x = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().x
      return {
        server: x('.sidebar-server-copy strong'),
        folder: x('.project-heading > span'),
        session: x('.session-entry.selected strong')
      }
    })
    expect(hierarchy.folder - hierarchy.server).toBeGreaterThanOrEqual(5)
    expect(hierarchy.folder - hierarchy.server).toBeLessThanOrEqual(9)
    expect(hierarchy.session - hierarchy.folder).toBeGreaterThanOrEqual(5)
    expect(hierarchy.session - hierarchy.folder).toBeLessThanOrEqual(9)
    const group = page.getByRole('button', { name: 'project', exact: true })
    await expect(group.locator('svg')).toHaveCount(1)
    await group.click({ position: { x: 120, y: 14 } })
    await expect(selected).toBeHidden()
    await expect(group.locator('.lucide-folder')).toBeVisible()
    await group.press('ArrowRight')
    await expect(selected).toBeVisible()
    // A pinned title and the hover menu must not compete with the status slot.
    await page.locator('.session-menu > summary').click()
    await page
      .locator('.session-menu-content')
      .getByRole('button', { name: '置顶会话', exact: true })
      .click()
    const measurements: unknown[] = []
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.locator('.settings-modal')
      await dialog.getByRole('button', { name: '外观', exact: true }).click()
      await dialog
        .getByRole('button', { name: theme === 'light' ? '浅色' : '深色', exact: true })
        .click()
      await page.keyboard.press('Escape')
      for (const [width, height, zoom] of [
        [1440, 920, 1],
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
        await command(app, { type: 'status', target, status: { state: 'checking' } })
        await expect(icon).toHaveAccessibleName('检查中')
        await selected.hover()
        await page.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
        )
        const geometry = await page.evaluate(() => {
          const box = (selector: string) => {
            const r = document.querySelector(selector)!.getBoundingClientRect()
            return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height }
          }
          return {
            title: box('.session-entry.selected strong'),
            icon: box('.session-entry.selected .session-status-icon'),
            menu: box('.session-entry.selected + .session-row-actions'),
            headerTitle: box('.workspace-title h1'),
            headerIcon: box('.connection-label'),
            actions: box('.header-actions'),
            viewport: innerWidth,
            scroll: document.documentElement.scrollWidth,
            scrollY,
            bodyScroll: document.body.scrollTop,
            rootScroll: document.getElementById('root')!.scrollTop
          }
        })
        expect(geometry.title.width).toBeGreaterThan(40)
        expect(geometry.title.right).toBeLessThan(geometry.icon.x)
        expect(geometry.icon.right).toBeLessThanOrEqual(geometry.menu.x)
        expect(geometry.icon.height).toBeLessThanOrEqual(baseline)
        expect(geometry.headerIcon.x).toBeGreaterThan(geometry.headerTitle.right)
        expect(geometry.headerIcon.y, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0)
        expect(geometry.headerIcon.right).toBeLessThanOrEqual(geometry.viewport - 140)
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport)
        await expect(page.locator('.workspace-title .connection-label')).toHaveCount(0)
        await expect(page.locator('.header-actions .connection-label')).toHaveAccessibleName(
          '检查中'
        )
        measurements.push({ theme, width, zoom, ...geometry })
        const png = await app.evaluate(async ({ BrowserWindow }) =>
          (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
            .toPNG()
            .toString('base64')
        )
        await writeFile(
          resolve(folder, `${theme}-${width}-${zoom}.png`),
          Buffer.from(png, 'base64')
        )
        await page.locator('.session-entry.selected + .session-row-actions > button').click()
        await expect(page.getByRole('menu')).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(icon.locator('svg')).toHaveCSS('animation-name', 'none')
    await writeFile(
      resolve(folder, 'measurements.json'),
      JSON.stringify({ hierarchy, measurements }, null, 2)
    )
  } finally {
    await app.close()
  }
})
