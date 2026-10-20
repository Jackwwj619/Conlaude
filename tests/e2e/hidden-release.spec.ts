import { _electron as electron, chromium, expect, test, type Browser } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { applicationVersion, packagedExecutable, verifyRuntime } from './runtime-target'

test('packaged release starts with an isolated profile and stays hidden', async () => {
  const executablePath = packagedExecutable()
  const app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_TEST_HIDDEN: '1',
      CLB_USER_DATA_DIR: test.info().outputPath('profile')
    }
  })
  try {
    await verifyRuntime(app, executablePath, test.info())
    const page = await app.firstWindow()
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.getByRole('button', { name: '右侧栏', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '底部栏', exact: true })).toBeVisible()
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).profiles).toEqual([])
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())
    ).toBe(false)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await test.info().attach('hidden-startup', {
      body: JSON.stringify({ version: applicationVersion, visible: false, settingsOpened: true }),
      contentType: 'application/json'
    })
  } finally {
    await app.close()
  }
})

test('portable release extracts and starts with an isolated hidden profile', async () => {
  test.setTimeout(90000)
  const executable = resolve(
    `dist/Conlaude-${applicationVersion}/Conlaude-Portable-${applicationVersion}-x64.exe`
  )
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_TEST_HIDDEN: '1',
      CLB_USER_DATA_DIR: test.info().outputPath('profile')
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
        { timeout: 60000 }
      )
      .toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = browser.contexts()[0]!.pages()[0]!
    await expect(page.locator('.app-shell')).toBeVisible()
    expect(await page.evaluate(() => window.claudeBridge.app.getVersion())).toBe(applicationVersion)
    expect((await page.evaluate(() => window.claudeBridge.settings.get())).profiles).toEqual([])
    await expect(page.getByRole('button', { name: '底部栏', exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('portable-hidden.png') })
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
