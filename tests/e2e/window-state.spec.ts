import { _electron as electron, expect, test } from '@playwright/test'

test('restores window size and maximization across process restarts', async () => {
  test.setTimeout(60000)
  const options = {
    args: ['.'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      CLB_USER_DATA_DIR: test.info().outputPath('profile')
    }
  }
  let app = await electron.launch(options)
  try {
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setBounds({ x: 60, y: 50, width: 1100, height: 740 })
    })
    const expected = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getNormalBounds()
    )
    await app.close()
    app = await electron.launch(options)
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
    ).toEqual(expected)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())
      )
      .toBe(true)
    await app.close()
    app = await electron.launch(options)
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())
      )
      .toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.unmaximize())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
      )
      .toEqual(expected)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMinimized())
      )
      .toBe(true)
    await app.close()
    app = await electron.launch(options)
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
    ).toEqual(expected)
  } finally {
    await app.close()
  }
})
