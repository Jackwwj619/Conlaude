import { _electron as electron, expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { useOfflineSessionList } from './offline-shell'

const projectRoot = resolve(import.meta.dirname, '..', '..')

test('deletes saved servers, persists an empty library across restart, and adds a new server', async () => {
  test.setTimeout(90000)
  const dataPath = resolve(projectRoot, 'test-results', `server-deletion-${Date.now()}`)
  const launch = () =>
    electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: dataPath }
    })
  let app = await launch()
  const errors: string[] = []
  try {
    let page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await useOfflineSessionList(app)
    await page.evaluate(async (defaults) => {
      await window.claudeBridge.settings.update({
        ...defaults,
        profiles: [
          defaults.profiles[0]!,
          { ...defaults.profiles[0]!, id: 'exp', label: 'Experiments', sshHost: 'exp' },
          { ...defaults.profiles[0]!, id: 'dev', label: 'Development', sshHost: 'dev' }
        ]
      })
    }, DEFAULT_SETTINGS)
    await page.reload()
    await expect(page.locator('.server-card')).toHaveCount(3)

    await page.getByRole('button', { name: '删除服务器 Development', exact: true }).click()
    await page.screenshot({ path: 'test-results/server-delete-dialog.png', animations: 'disabled' })
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
    await expect(page.locator('.server-card')).toHaveCount(3)
    await page.getByRole('button', { name: '删除服务器 Development', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除服务器', exact: true }).click()
    await expect(page.locator('.server-card')).toHaveCount(2)
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).currentProfileId).toBe(
      'mas'
    )
    await page.reload()
    await expect(page.locator('.server-card')).toHaveCount(2)

    await page
      .getByRole('button', {
        name: `删除服务器 ${DEFAULT_SETTINGS.profiles[0]!.label}`,
        exact: true
      })
      .click()
    await page.getByRole('dialog').getByRole('button', { name: '删除服务器', exact: true }).click()
    await expect(page.locator('.server-card')).toHaveCount(1)
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).currentProfileId).toBe(
      'exp'
    )
    await page.getByRole('button', { name: '删除服务器 Experiments', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '删除服务器', exact: true }).click()
    await expect(page.getByRole('heading', { name: '还没有服务器' })).toBeVisible()
    expect(await page.evaluate(() => window.claudeBridge.settings.get())).toMatchObject({
      profiles: [],
      currentProfileId: ''
    })

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await useOfflineSessionList(app, false)
    await expect(page.getByRole('heading', { name: '还没有服务器' })).toBeVisible()
    await expect(page.locator('.server-card')).toHaveCount(0)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '服务器', exact: true }).click()
    await expect(
      page.getByRole('dialog').getByText('添加服务器或导入 SSH 配置，即可开始使用。')
    ).toBeVisible()
    await page
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()

    await page.getByRole('button', { name: '添加服务器', exact: true }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('New server')
    await page.getByLabel('OpenSSH Host', { exact: false }).fill('new-host')
    await page.getByRole('button', { name: '保存服务器', exact: true }).click()
    await expect(page.locator('.server-card')).toHaveCount(1)
    const saved = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(saved.currentProfileId).toBe(saved.profiles[0]!.id)
    expect(saved.profiles[0]!.label).toBe('New server')
    await page.reload()
    await expect(page.locator('.server-card')).toHaveCount(1)
    await expect(page.locator('.server-card')).toContainText('New server')
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
