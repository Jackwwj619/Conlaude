import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import {
  packagedExecutable,
  personalSnapshot,
  verifyRuntime,
  bundledHelperVersion
} from './runtime-target'

test('current package uses daily settings and reaches the configured servers without fixture data', async () => {
  const info = test.info()
  test.setTimeout(90000)
  const snapshot = await personalSnapshot(info)
  const executablePath = packagedExecutable()
  const app = await electron.launch({
    executablePath,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: snapshot.path }
  })
  try {
    await verifyRuntime(app, executablePath, info)
    const page = await app.firstWindow()
    const loaded = await page.evaluate(() => window.claudeBridge.settings.get())
    expect(loaded).toMatchObject(snapshot.settings)
    await expect(page.locator('.brand strong')).toHaveText('Conlaude')
    const english = loaded.language === 'en-US'
    await page.getByRole('button', { name: english ? 'Settings' : '设置', exact: true }).click()
    await expect(
      page.getByLabel(english ? 'Interface language' : '界面语言', { exact: true })
    ).toHaveValue(loaded.language)
    await page.keyboard.press('Escape')
    const results = await page.evaluate(async () => {
      const settings = await window.claudeBridge.settings.get()
      return Promise.all(
        settings.profiles.map(async (profile) => {
          try {
            const [sessions, helper] = await Promise.all([
              window.claudeBridge.sessions.list(profile.id),
              window.claudeBridge.helper.status(profile.id)
            ])
            return {
              profileId: profile.id,
              profileLabel: profile.label,
              sessions: sessions.length,
              helper,
              error: null
            }
          } catch (error) {
            return { profileId: profile.id, profileLabel: profile.label, error: String(error) }
          }
        })
      )
    })
    await writeFile(info.outputPath('real-server-checks.json'), JSON.stringify(results, null, 2))
    await info.attach('real-server-checks', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json'
    })
    await page.screenshot({ path: info.outputPath('daily-config.png') })
    for (const result of results) {
      expect.soft(result.error, `Actual server ${result.profileLabel}`).toBeNull()
      expect
        .soft(
          result.helper?.installed,
          `${result.profileLabel}: ${result.helper?.detail ?? result.error}`
        )
        .toBe(true)
      expect
        .soft(
          result.helper?.version,
          `${result.profileLabel}: bundled helper ${bundledHelperVersion}, remote helper ${result.helper?.version ?? 'missing'}`
        )
        .toBe(bundledHelperVersion)
    }
  } finally {
    await app.close()
    expect(createHash('sha256').update(readFileSync(snapshot.source)).digest('hex')).toBe(
      snapshot.originalHash
    )
  }
})
