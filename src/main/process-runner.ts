import { spawn } from 'node:child_process'

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
}

export async function runProcess(
  executable: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string; maxOutputBytes?: number; input?: string } = {}
): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 15000
  const maxOutputBytes = options.maxOutputBytes ?? 2_000_000

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    // Both output streams are always piped; only stdin is conditional.
    const stdoutStream = child.stdout!
    const stderrStream = child.stderr!
    stdoutStream.setEncoding('utf8')
    stderrStream.setEncoding('utf8')

    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    const append = (target: 'stdout' | 'stderr', chunk: string): void => {
      outputBytes += Buffer.byteLength(chunk, 'utf8')
      if (outputBytes > maxOutputBytes) {
        child.kill()
        finish(() => reject(new Error('Child process output exceeded the safety limit')))
        return
      }
      if (target === 'stdout') stdout += chunk
      else stderr += chunk
    }

    stdoutStream.on('data', (chunk: string) => append('stdout', chunk))
    stderrStream.on('data', (chunk: string) => append('stderr', chunk))
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => finish(() => resolve({ exitCode: code ?? -1, stdout, stderr })))

    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error(`Child process timed out after ${timeoutMs} ms`)))
    }, timeoutMs)
    if (child.stdin) {
      child.stdin.on('error', (error) => finish(() => reject(error)))
      child.stdin.end(options.input)
    }
  })
}
