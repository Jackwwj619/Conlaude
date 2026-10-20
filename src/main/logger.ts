import log from 'electron-log/main'
import { homedir } from 'node:os'

const home = homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const homePattern = new RegExp(home, 'gi')

export function redact(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  return text
    .replace(homePattern, '%USERPROFILE%')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b(sk-ant-|sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}\b/g, '<secret>')
    .replace(/(identityfile\s+).+/gi, '$1<redacted>')
}

log.initialize()
log.transports.file.level = 'info'
log.transports.console.level = 'info'
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'

export const logger = {
  info(message: string): void {
    log.info(redact(message))
  },
  warn(message: string): void {
    log.warn(redact(message))
  },
  error(message: string, error?: unknown): void {
    log.error(redact(`${message}${error ? `: ${redact(error)}` : ''}`))
  }
}
