import type { ElectronApplication, TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { AppSettings } from '../../src/shared/contracts'

export const projectRoot = resolve(import.meta.dirname, '../..')
export const applicationVersion: string = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8')
).version
export const bundledHelperVersion = readFileSync(
  join(projectRoot, 'remote/bridge_agent.py'),
  'utf8'
).match(/^VERSION\s*=\s*["']([^"']+)["']/m)![1]!

export function packagedExecutable(): string {
  const executable = resolve(
    process.env.CLB_TEST_EXECUTABLE ??
      process.env.CLB_PACKAGED_EXE ??
      join(projectRoot, `dist/Conlaude-${applicationVersion}/win-unpacked/Conlaude.exe`)
  )
  if (!existsSync(executable))
    throw new Error(`Packaged application missing: ${executable}. Run npm run dist first.`)
  return executable
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

export async function verifyRuntime(
  app: ElectronApplication,
  executable: string,
  info: TestInfo
): Promise<void> {
  const actualVersion = await app.evaluate(({ app }) => app.getVersion())
  const expectedVersion = process.env.CLB_EXPECTED_VERSION ?? applicationVersion
  if (actualVersion !== expectedVersion)
    throw new Error(
      `Wrong test binary: expected ${expectedVersion}, launched ${actualVersion} at ${executable}`
    )
  const archive = join(dirname(executable), 'resources/app.asar')
  // An explicit older-version override is for diagnosing that release, not current-build acceptance.
  let matchedBuildFiles = 0
  if (expectedVersion === applicationVersion) {
    const { extractFile } = createRequire(import.meta.url)(
      '@electron/asar'
    ) as typeof import('@electron/asar')
    const output = join(projectRoot, 'out')
    const builtAt = statSync(join(output, 'renderer/index.html')).mtimeMs
    const inputs = [
      ...filesUnder(join(projectRoot, 'src')),
      join(projectRoot, 'electron.vite.config.ts')
    ]
    if (inputs.some((path) => statSync(path).mtimeMs > builtAt))
      throw new Error(
        'Source files are newer than the renderer build. Rebuild and repackage before acceptance testing.'
      )
    for (const file of filesUnder(output)) {
      const packedPath = relative(projectRoot, file)
      if (!readFileSync(file).equals(extractFile(archive, packedPath)))
        throw new Error(`Packaged file differs from the current build: ${packedPath}`)
      matchedBuildFiles++
    }
    if (
      !readFileSync(join(projectRoot, 'remote/bridge_agent.py')).equals(
        readFileSync(join(dirname(executable), 'resources/remote/bridge_agent.py'))
      )
    )
      throw new Error('Packaged remote helper differs from the current source.')
  }
  await info.attach('runtime-target', {
    body: JSON.stringify(
      { executable, actualVersion, expectedVersion, matchedBuildFiles, bundledHelperVersion },
      null,
      2
    ),
    contentType: 'application/json'
  })
}

export async function personalSnapshot(info: TestInfo): Promise<{
  path: string
  settings: AppSettings
  source: string
  originalHash: string
}> {
  const source = process.env.CLB_TEST_CONFIG
    ? resolve(process.env.CLB_TEST_CONFIG)
    : process.env.APPDATA
      ? join(process.env.APPDATA, 'Claude Local Bridge/config.json')
      : ''
  if (!source || !existsSync(source))
    throw new Error(
      'Daily configuration not found. Set CLB_TEST_CONFIG to the config.json you actually use; no example profile is substituted.'
    )
  const bytes = readFileSync(source)
  const settings = JSON.parse(bytes.toString('utf8')) as AppSettings
  if (!Array.isArray(settings.profiles) || !settings.profiles.length)
    throw new Error(`No real server profiles in ${source}`)
  const path = info.outputPath('personal-profile')
  await mkdir(path, { recursive: true })
  await copyFile(source, join(path, 'config.json'))
  const windowState = join(dirname(source), 'window-state.json')
  if (existsSync(windowState)) await copyFile(windowState, join(path, 'window-state.json'))
  const originalHash = createHash('sha256').update(bytes).digest('hex')
  await info.attach('configuration-source', {
    body: JSON.stringify(
      { source, originalHash, language: settings.language, profileCount: settings.profiles.length },
      null,
      2
    ),
    contentType: 'application/json'
  })
  return { path, settings, source, originalHash }
}
