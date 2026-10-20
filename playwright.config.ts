import { defineConfig } from '@playwright/test'

// Independent runs must not clear each other's screenshots, profiles or reports.
const runId = (process.env.CLB_TEST_RUN_ID ??= `${Date.now()}-${process.pid}`)

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `test-results/run-${runId}`,
  // Hidden Electron windows can take longer to produce screenshots on Windows.
  timeout: process.env.CLB_TEST_HIDDEN === '1' ? 90000 : 30000,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: `playwright-report/acceptance/run-${runId}`, open: 'never' }]
  ],
  use: {
    trace: 'retain-on-failure'
  }
})
