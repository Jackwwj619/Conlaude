import { expect, type Page } from '@playwright/test'

/** Select through the profile default so opening the action menu never attaches writable. */
export async function openReadonlySession(page: Page, sessionName: string): Promise<void> {
  await page.evaluate(async (name) => {
    const settings = await window.claudeBridge.settings.get()
    await window.claudeBridge.settings.update({
      ...settings,
      profiles: settings.profiles.map((profile) =>
        profile.id === settings.currentProfileId ? { ...profile, defaultSession: name } : profile
      )
    })
  }, sessionName)
  await page.reload()
  await page.locator('.project-heading').first().click()
  await expect(page.locator('.workspace-header h1')).toHaveText(sessionName, { timeout: 20000 })
  await page.getByLabel('会话操作', { exact: true }).click()
  await page.getByRole('button', { name: '以只读方式打开', exact: true }).click()
  await expect(page.locator('.connection-label.attached')).toBeVisible({ timeout: 20000 })
}
