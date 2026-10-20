import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { packagedExecutable, verifyRuntime } from './runtime-target'

test('slim Windows package retains supported locales and working native terminal backends', async () => {
  const info = test.info()
  test.skip(process.platform !== 'win32')
  const executablePath = packagedExecutable()
  const root = dirname(executablePath)
  expect(readdirSync(join(root, 'locales')).sort()).toEqual(['en-US.pak', 'zh-CN.pak'])
  const ptyRoot = join(root, 'resources/app.asar.unpacked/node_modules/node-pty')
  expect(readdirSync(join(ptyRoot, 'prebuilds'))).toEqual(['win32-x64'])
  for (const folder of ['build', 'deps', 'src', 'scripts', 'third_party'])
    expect(existsSync(join(ptyRoot, folder))).toBe(false)
  expect(readdirSync(join(ptyRoot, 'lib')).some((file) => /\.(map|test\.js)$/.test(file))).toBe(
    false
  )

  const app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: resolve(`test-results/packaged-size-${Date.now()}`)
    }
  })
  try {
    await verifyRuntime(app, executablePath, info)
    const results = await app.evaluate(async ({ app }) => {
      const { createRequire } = process.getBuiltinModule('module')
      const runtimeRequire = createRequire(`${app.getAppPath()}/package.json`)
      const pty = runtimeRequire('node-pty') as typeof import('node-pty')
      const results: {
        useConptyDll: boolean
        output: string
        exitCode: number
        resized: boolean
      }[] = []
      for (const useConptyDll of [false, true]) {
        results.push(
          await new Promise<(typeof results)[number]>((resolve, reject) => {
            const terminal = pty.spawn('cmd.exe', ['/d', '/q'], {
              cols: 80,
              rows: 24,
              cwd: app.getPath('temp'),
              env: process.env,
              useConpty: true,
              useConptyDll
            })
            let output = ''
            let resized = false
            let ending = false
            const timeout = setTimeout(() => {
              terminal.kill()
              reject(new Error(`Packaged terminal timed out (DLL=${useConptyDll})`))
            }, 8000)
            terminal.onData((chunk) => {
              output += chunk
              if (!resized) {
                terminal.resize(100, 30)
                resized = true
                terminal.write('echo CONLAUDE_PTY_OK\r')
              }
              if (!ending && output.includes('CONLAUDE_PTY_OK')) {
                ending = true
                terminal.write('exit\r')
              }
            })
            terminal.onExit(({ exitCode }) => {
              clearTimeout(timeout)
              resolve({ useConptyDll, output, exitCode, resized })
            })
          })
        )
      }
      return results
    })
    for (const result of results) {
      expect(result.resized).toBe(true)
      expect(result.output).toContain('CONLAUDE_PTY_OK')
      expect(result.exitCode).toBe(0)
    }
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByLabel('界面语言', { exact: true }).selectOption('en-US')
    await expect(page.getByLabel('Interface language', { exact: true })).toHaveValue('en-US')
    await page.getByLabel('Interface language', { exact: true }).selectOption('zh-CN')
    await expect(page.getByLabel('界面语言', { exact: true })).toHaveValue('zh-CN')
  } finally {
    await app.close()
  }
})
