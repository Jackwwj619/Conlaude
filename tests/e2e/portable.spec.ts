import { chromium, expect, test, type Browser } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { applicationVersion } from './runtime-target'

test('portable launcher extracts, opens and exposes the correct Windows taskbar identity', async () => {
  test.setTimeout(60000)
  const version = applicationVersion
  const executable =
    process.env.CLB_PORTABLE_EXE ??
    resolve(`dist/Conlaude-${version}/Conlaude-Portable-${version}-x64.exe`)
  test.skip(process.platform !== 'win32')
  expect(existsSync(executable), `Missing portable release: ${executable}`).toBe(true)
  const folder = resolve(`playwright-report/release-${version}/portable`)
  await mkdir(folder, { recursive: true })
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  // NSIS does not forward the inspector pipes used by electron.launch; use CDP
  // to verify the actual standalone launcher and its extracted application.
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(folder, `profile-${Date.now()}`)
    },
    windowsHide: true,
    stdio: 'ignore'
  })
  let browser: Browser | undefined
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok
          } catch {
            return false
          }
        },
        { timeout: 40000 }
      )
      .toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts()[0]!.pages()[0]!
    await expect(page).toHaveTitle('Conlaude')
    await expect(page.locator('.brand strong')).toHaveText('Conlaude')
    await expect(page.locator('.brand .brand-logo')).toBeVisible()
    expect(
      await page
        .locator('.brand .brand-logo')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
    ).toBe(true)
    expect(await page.evaluate(() => window.claudeBridge.app.getVersion())).toBe(version)
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).profiles).toEqual([])
    const command = `Get-CimInstance Win32_Process -Filter "name = 'Conlaude.exe'" | Where-Object { $_.CommandLine -match '--remote-debugging-port=${port}( |$)' } | ForEach-Object { (Get-Process -Id $_.ProcessId).MainWindowHandle.ToInt64() } | Where-Object { $_ -ne 0 }`
    const exec = promisify(execFile)
    const handles = (await exec('powershell.exe', ['-NoProfile', '-Command', command])).stdout
      .trim()
      .split(/\s+/)
    expect(handles).toHaveLength(1)
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile',
      '-File',
      resolve('tests/e2e/windows-icon.ps1'),
      '-WindowHandle',
      handles[0]!,
      '-OutputDirectory',
      folder
    ])
    const report = JSON.parse(stdout.trim())
    expect(report.appId).toBe('com.local.claudelocalbridge.portable')
    expect(report.resolvedDisplayName).toBe('Conlaude')
    expect(report.relaunchIcon).toBe(`${executable},0`)
    expect(report.relaunchCommand).toBe(`"${executable}"`)
    await writeFile(
      resolve(folder, 'verification.json'),
      JSON.stringify({ version, ...report }, null, 2)
    )
    await page.screenshot({ path: resolve(folder, 'startup.png') })
    await page.evaluate(() => window.bridgeWindow.execute('quit')).catch(() => undefined)
    await expect.poll(() => child.exitCode, { timeout: 10000 }).toBe(0)
  } finally {
    await browser?.close().catch(() => undefined)
    if (child.exitCode === null && child.pid)
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F']).catch(
        () => undefined
      )
  }
})
