import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fixture } from './workspace-fixture'
import { IPC } from '../../src/shared/ipc'
test('server settings keep consistent typography, local errors and keyboard return', async () => {
  const app = await electron.launch({
    args: [resolve('tests/e2e/offline-entry.mjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/explore-${Date.now()}`)
    }
  })
  try {
    await fixture(app)
    await app.evaluate(({ ipcMain }, channels) => {
      for (const ch of [
        channels.profilesGetSshConfig,
        channels.profilesRevealSshConfig,
        channels.profilesSaveSshConfig,
        channels.profilesTest
      ])
        ipcMain.removeHandler(ch)
      ipcMain.handle(channels.profilesGetSshConfig, () => ({
        path: 'C:/Users/demo/.ssh/config',
        content: 'Host exp\n  HostName example.test',
        entries: []
      }))
      ipcMain.handle(channels.profilesRevealSshConfig, () => {
        throw new Error('Could not open File Explorer')
      })
      ipcMain.handle(channels.profilesTest, () => ({ ok: true }))
    }, IPC)
    await app.evaluate(() =>
      (
        globalThis as unknown as { resumeOfflineRenderer: () => Promise<void> }
      ).resumeOfflineRenderer()
    )
    const page = await app.firstWindow()
    const dir = resolve('playwright-report/ux-audit')
    await mkdir(dir, { recursive: true })
    const capture = async (name: string) => {
      await page.evaluate(async () => {
        await document.fonts.ready
        document.getAnimations().forEach((a) => {
          try {
            a.finish()
          } catch {
            /* Persistent effects do not block captures. */
          }
        })
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r()))
        )
      })
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
          .toPNG()
          .toString('base64')
      )
      await writeFile(resolve(dir, name + '.png'), Buffer.from(png, 'base64'))
    }
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '服务器', exact: true }).click()

    const selector = page.getByLabel('服务器配置', { exact: true })
    await selector.selectOption('exp')
    await expect(page.locator('.settings-profile-summary')).toContainText('/srv/Experiments')
    const current = await page.evaluate(
      async () => (await window.claudeBridge.settings.get()).currentProfileId
    )
    expect(current).toBe('mas')
    await expect(selector).toHaveCSS(
      'font-family',
      await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)
    )
    await expect(selector).toHaveCSS('height', '35px')
    await capture('server-settings')
    await page.getByRole('button', { name: '在文件夹中显示', exact: true }).click()
    await expect(page.locator('.settings-ssh-file [role="alert"]')).toContainText(
      'Could not open File Explorer'
    )
    await expect(page.getByRole('button', { name: '重试保存', exact: true })).toHaveCount(0)
    await expect(page.locator('.settings-footer')).toContainText('已保存')
    await capture('reveal-error')
    const edit = page.getByRole('button', { name: '编辑服务器与会话默认值' })
    await edit.click()
    await expect(page.getByLabel('服务器名称', { exact: true })).toHaveValue('EXP · Experiments')
    const font = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)
    for (const control of await page.locator('.profile-editor input,.profile-editor select').all())
      await expect(control).toHaveCSS('font-family', font)
    await capture('profile-editor')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(edit).toBeFocused()
    await expect(selector).toHaveValue('exp')
    await page.getByRole('button', { name: '常规', exact: true }).click()
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US')
    await page.getByRole('button', { name: 'Servers', exact: true }).click()
    await expect(page.getByLabel('Server profile', { exact: true })).toHaveValue('exp')
    await capture('server-settings-en')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.getByRole('button', { name: 'Servers', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!
      w.setSize(980, 680)
      w.webContents.setZoomFactor(1.5)
    })
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(700)
    await capture('server-settings-small-dark')
    const bounds = await page
      .locator('.settings-panel')
      .evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }))
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1)
    await page.getByRole('button', { name: 'Edit server and session defaults' }).click()
    await page.getByRole('button', { name: 'Manual setup', exact: true }).click()
    await capture('profile-editor-small-dark')
    const layout = await page.locator('.profile-editor').evaluate((el) => {
      const header = el.querySelector('.modal-header')!.getBoundingClientRect()
      const scroll = el.querySelector('.profile-editor-scroll')!.getBoundingClientRect()
      const footer = el.querySelector('.modal-footer')!.getBoundingClientRect()
      return {
        headerTop: header.top,
        headerBottom: header.bottom,
        scrollTop: scroll.top,
        scrollBottom: scroll.bottom,
        footerTop: footer.top,
        footerBottom: footer.bottom,
        height: innerHeight
      }
    })
    expect(layout.headerTop).toBeGreaterThanOrEqual(0)
    expect(layout.headerBottom).toBeLessThanOrEqual(layout.scrollTop + 1)
    expect(layout.scrollBottom).toBeLessThanOrEqual(layout.footerTop + 1)
    expect(layout.footerBottom).toBeLessThanOrEqual(layout.height)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Unsaved changes', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue editing', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Manual setup', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    for (const control of await page.locator('.profile-editor input,.profile-editor select').all())
      await expect(control).toHaveCSS('font-family', font)
  } finally {
    await app.close()
  }
})
