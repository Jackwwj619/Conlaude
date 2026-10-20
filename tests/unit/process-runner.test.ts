import { expect, it } from 'vitest'
import { runProcess } from '../../src/main/process-runner'

it('streams large Unicode file contents on stdin without command-line interpolation', async () => {
  const input = "中文 '$()`\n".repeat(50000)
  const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
    input
  })
  expect(result.stdout).toBe(input)
  expect(result.exitCode).toBe(0)
})

it('decodes UTF-8 incrementally on both process streams', async () => {
  const result = await runProcess(process.execPath, [
    '-e',
    `const b=Buffer.from('中文🌏');process.stdout.write(b.subarray(0,1));process.stderr.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(1));process.stderr.write(b.subarray(2));},30)`
  ])
  expect(result.stdout).toBe('中文🌏')
  expect(result.stderr).toBe('中文🌏')
  expect(result.exitCode).toBe(0)
})
