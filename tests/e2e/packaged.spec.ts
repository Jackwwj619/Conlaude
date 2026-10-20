import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { applicationVersion, packagedExecutable, verifyRuntime } from './runtime-target'

const projectRoot = resolve(import.meta.dirname, '..', '..')
test('fresh installation opens the current release with no example server profiles', async () => {
  const executablePath = packagedExecutable()
  const shellUserDataPath = test.info().outputPath('fresh-profile')
  const electronApp = await electron.launch({
    executablePath,
    env: { ...process.env, NODE_ENV: 'test', CLB_USER_DATA_DIR: shellUserDataPath }
  })

  try {
    await verifyRuntime(electronApp, executablePath, test.info())
    if (process.platform === 'win32') {
      const iconFolder = resolve(
        projectRoot,
        'playwright-report',
        `release-${applicationVersion}`,
        'windows-icons'
      )
      await mkdir(iconFolder, { recursive: true })
      const handle = await electronApp.evaluate(({ BrowserWindow }) =>
        Number(BrowserWindow.getAllWindows()[0]!.getNativeWindowHandle().readBigUInt64LE())
      )
      const { stdout } = await promisify(execFile)('powershell.exe', [
        '-NoProfile',
        '-File',
        resolve('tests/e2e/windows-icon.ps1'),
        '-WindowHandle',
        String(handle),
        '-OutputDirectory',
        iconFolder
      ])
      const report = JSON.parse(stdout.trim())
      expect(report.appId).toBe('com.local.claudelocalbridge')
      expect(report.resolvedDisplayName).toBe('Conlaude')
      expect(report.relaunchIcon).toContain(executablePath)
      expect(report.relaunchCommand).toBe(`"${executablePath}"`)
      const difference = await electronApp.evaluate(
        ({ nativeImage }, actualPath) => {
          const expected = nativeImage
            .createFromPath(`${process.resourcesPath}/icon.ico`)
            .resize({ width: 32, height: 32 })
            .toBitmap()
          const actual = nativeImage
            .createFromPath(actualPath)
            .resize({ width: 32, height: 32 })
            .toBitmap()
          if (expected.length !== actual.length || !expected.length) return Infinity
          return (
            actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]!), 0) /
            actual.length
          )
        },
        resolve(iconFolder, 'window-icon-1.png')
      )
      expect(difference).toBeLessThan(20)
      await writeFile(
        resolve(iconFolder, 'verification.json'),
        JSON.stringify({ ...report, pixelDifference: difference }, null, 2)
      )
    }
    const page = await electronApp.firstWindow()
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).profiles).toEqual([])
    await expect(page.locator('.task-sidebar').getByText('Conlaude', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '外观', exact: true }).click()
    await expect(page.getByLabel('界面字体', { exact: true })).toHaveValue('Mona Sans')
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).interfaceFont).toBe(
      'mona-sans'
    )
    await page.getByRole('button', { name: '常规', exact: true }).click()
    await expect(page.getByLabel('界面语言', { exact: true })).toHaveValue('zh-CN')
    await page
      .locator('.settings-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click()
  } finally {
    await electronApp.close()
  }
})
