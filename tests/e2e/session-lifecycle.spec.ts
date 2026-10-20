import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const userDataPath = resolve(projectRoot, 'test-results', 'user-data-lifecycle')

test('renames and explicitly terminates only the selected tmux session', async () => {
  test.setTimeout(60000)
  const suffix = Date.now()
  const originalName = `bridge-lifecycle-${suffix}`
  const renamedName = `bridge-renamed-${suffix}`
  execFileSync('ssh', [
    '-o',
    'BatchMode=yes',
    'mas',
    `tmux new-session -d -s '${originalName}' cat`
  ])

  const electronApp = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: userDataPath }
  })

  try {
    const page = await electronApp.firstWindow()
    await page.locator('.project-heading').first().click()
    const originalRow = page.locator('.session-row').filter({ hasText: originalName })
    await expect(originalRow).toBeVisible({ timeout: 20000 })
    await originalRow.click()
    await expect(page.locator('.connection-label.attached')).toBeVisible({ timeout: 20000 })
    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '断开本地连接', exact: true }).click()
    await expect(page.locator('.connection-label.detached')).toBeVisible()

    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '修改远端标识…', exact: true }).click()
    const renameDialog = page.getByRole('dialog', { name: '重命名会话' })
    await renameDialog.locator('input').fill(renamedName)
    await renameDialog.getByRole('button', { name: '保存名称' }).click()
    const renamedRow = page.locator('.session-row').filter({ hasText: renamedName })
    await expect(renamedRow).toBeVisible({ timeout: 20000 })
    await renamedRow.click()

    await page.getByLabel('会话操作', { exact: true }).click()
    await page.getByRole('button', { name: '终止远端会话…', exact: true }).click()
    const terminateDialog = page.getByRole('dialog', { name: '终止远端会话' })
    await terminateDialog.locator('input').fill(renamedName)
    await terminateDialog.getByRole('button', { name: '终止远端会话' }).click()
    await expect(renamedRow).toHaveCount(0, { timeout: 20000 })
  } finally {
    await electronApp.close()
    execFileSync('ssh', [
      '-o',
      'BatchMode=yes',
      'mas',
      `tmux kill-session -t '${originalName}' 2>/dev/null || true; tmux kill-session -t '${renamedName}' 2>/dev/null || true`
    ])
  }
})
