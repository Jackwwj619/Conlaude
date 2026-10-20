import type { ElectronApplication } from '@playwright/test'
import { IPC } from '../../src/shared/ipc'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
import { bundledHelperVersion } from './runtime-target'

/** UI regression checks stay offline; exp-iteration.spec.ts covers real SSH. */
export async function useOfflineSessionList(
  app: ElectronApplication,
  seedProfile = true
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channels, helperVersion }) => {
      ipcMain.removeHandler(channels.sessionsList)
      ipcMain.handle(channels.sessionsList, () => [])
      ipcMain.removeHandler(channels.helperStatus)
      ipcMain.handle(channels.helperStatus, () => ({
        installed: true,
        version: helperVersion,
        detail: 'UI test'
      }))
    },
    { channels: IPC, helperVersion: bundledHelperVersion }
  )
  const page = await app.firstWindow()
  if (!seedProfile) return
  await page.evaluate(async (defaults) => {
    const current = await window.claudeBridge.settings.get()
    if (!current.profiles.length)
      await window.claudeBridge.settings.update({
        ...current,
        profiles: defaults.profiles,
        currentProfileId: defaults.currentProfileId
      })
  }, DEFAULT_SETTINGS)
  await page.reload()
}
