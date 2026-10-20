import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { useOfflineSessionList } from './offline-shell'
const root = resolve(import.meta.dirname, '../..')
test('settings keep font queries separate, protect server drafts, and fit scaled windows', async () => {
  test.setTimeout(90000)
  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(root, `test-results/settings-migration-${Date.now()}`)
    }
  })
  const evidence = resolve(root, 'playwright-report/codex-frontend-migration/settings')
  await mkdir(evidence, { recursive: true })
  try {
    const page = await app.firstWindow()
    await useOfflineSessionList(app)
    await page.reload()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.locator('.settings-modal')
    await dialog.getByRole('button', { name: '外观', exact: true }).click()
    const font = dialog.getByRole('combobox', { name: '界面字体', exact: true })
    const original = await font.inputValue()
    await font.click()
    await font.fill('not a real font')
    await expect(page.locator('.font-popup').getByRole('option')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(font).toHaveValue(original)
    await font.click()
    await font.fill('宋')
    await font.dispatchEvent('compositionstart')
    await font.press('Enter')
    await expect(font).toHaveAttribute('aria-expanded', 'true')
    await font.dispatchEvent('compositionend')
    await page.keyboard.press('Escape')
    expect(
      await page.evaluate(async () => (await window.claudeBridge.settings.get()).interfaceFont)
    ).toBe('mona-sans')
    for (const zoom of [1, 1.25, 1.5]) {
      const size = await app.evaluate(({ BrowserWindow }, zoom) => {
        const win = BrowserWindow.getAllWindows()[0]!
        win.setSize(980, 680)
        win.webContents.setZoomFactor(zoom)
        return win.getContentSize()
      }, zoom)
      await expect
        .poll(() => page.evaluate(() => innerWidth))
        .toBeCloseTo(Math.round(size[0]! / zoom), -1)
      await font.click()
      await font.fill('宋')
      await expect(page.locator('.font-popup')).toBeVisible()
      await expect(page.locator('.font-popup-status')).not.toContainText('正在读取')
      const bounds = await page.evaluate(() => {
        const popup = document.querySelector('.font-popup')!.getBoundingClientRect(),
          modal = document.querySelector('.settings-modal')!.getBoundingClientRect()
        return {
          popup: { top: popup.top, bottom: popup.bottom, left: popup.left, right: popup.right },
          modal: { top: modal.top, bottom: modal.bottom, right: modal.right },
          width: innerWidth,
          height: innerHeight
        }
      })
      expect(bounds.popup.top).toBeGreaterThanOrEqual(0)
      expect(bounds.popup.bottom).toBeLessThanOrEqual(bounds.height + 1)
      expect(bounds.popup.right).toBeLessThanOrEqual(bounds.width + 1)
      expect(bounds.modal.bottom).toBeLessThanOrEqual(bounds.height + 1)
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage())
          .toPNG()
          .toString('base64')
      )
      await writeFile(resolve(evidence, `font-popup-${zoom}.png`), Buffer.from(png, 'base64'))
      await page.keyboard.press('Escape')
    }
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.webContents.setZoomFactor(1)
      win.setSize(1440, 920)
    })
    await dialog.getByRole('button', { name: '服务器', exact: true }).click()
    await dialog.getByRole('button', { name: '编辑服务器与会话默认值' }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('Unsaved server edit')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await expect(page.getByLabel('服务器名称', { exact: true })).toHaveValue('Unsaved server edit')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '放弃修改', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect(
      await page.evaluate(async () => (await window.claudeBridge.settings.get()).profiles[0]!.label)
    ).not.toBe('Unsaved server edit')
  } finally {
    await app.close()
  }
})
