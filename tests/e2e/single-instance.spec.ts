import { _electron as electron, expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

test('relaunch restores the existing window from tray and minimization', async () => {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    CLB_USER_DATA_DIR: test.info().outputPath('profile')
  }
  const packagedExecutable = process.env.CLB_TEST_EXECUTABLE
  const launchArgs = packagedExecutable ? [] : [resolve('.')]
  const app = await electron.launch({
    executablePath: packagedExecutable,
    args: launchArgs,
    env
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(async () => {
      const settings = await window.claudeBridge.settings.get()
      await window.claudeBridge.settings.update({ ...settings, closeToTray: true })
    })
    const originalId = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.id
    )
    const executable = await app.evaluate(() => process.execPath)
    for (const action of ['close', 'minimize'] as const) {
      await app.evaluate(({ BrowserWindow }, command) => {
        BrowserWindow.getAllWindows()[0]![command]()
      }, action)
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }, command) => {
            const window = BrowserWindow.getAllWindows()[0]!
            return command === 'close' ? !window.isVisible() : window.isMinimized()
          }, action)
        )
        .toBe(true)

      // Start a real second process, as a shortcut does, rather than emitting an event.
      // Windows may deny foreground focus to automation launched in the background;
      // assert instance identity and restored visibility independently of OS focus policy.
      const secondEnv: NodeJS.ProcessEnv = { ...env }
      delete secondEnv.ELECTRON_RUN_AS_NODE
      const second = spawn(executable, launchArgs, {
        env: secondEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      second.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      second.stderr.on('data', (chunk) => {
        output += chunk.toString()
      })
      try {
        await expect.poll(() => ({ code: second.exitCode, output })).toMatchObject({ code: 0 })
        await expect
          .poll(() =>
            app.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows().map((window) => ({
                id: window.id,
                visible: window.isVisible(),
                minimized: window.isMinimized()
              }))
            )
          )
          .toEqual([{ id: originalId, visible: true, minimized: false }])
        expect(await app.firstWindow()).toBe(page)
      } finally {
        if (second.exitCode === null) second.kill()
      }
    }
  } finally {
    await app.close()
  }
})
