import { isClaudePermissionMode, type ClaudePermissionMode, type TimelineEvent } from './contracts'

interface UnknownRecord {
  [key: string]: unknown
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function contentText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined

  const segments = content
    .map((item) => {
      if (!isRecord(item)) return undefined
      if (item.type === 'text') return stringValue(item.text)
      if (item.type === 'thinking') return stringValue(item.thinking)
      return undefined
    })
    .filter((value): value is string => Boolean(value))

  return segments.length > 0 ? segments.join('\n\n') : undefined
}

function idFor(raw: UnknownRecord, offset?: number): string {
  let hash = 2166136261
  for (const char of JSON.stringify(raw)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (
    stringValue(raw.uuid) ??
    stringValue(raw.id) ??
    `${stringValue(raw.type) ?? 'unknown'}-${offset ?? (hash >>> 0).toString(36)}`
  )
}

function permissionModeFor(
  raw: UnknownRecord,
  message?: UnknownRecord
): ClaudePermissionMode | undefined {
  const candidates = [
    raw.permissionMode,
    raw.permission_mode,
    message?.permissionMode,
    message?.permission_mode
  ]
  return candidates.find(isClaudePermissionMode)
}

function normalizeRawEvent(rawValue: unknown, offset?: number): TimelineEvent[] {
  if (!isRecord(rawValue)) {
    return []
  }

  const raw = rawValue
  const rawType = stringValue(raw.type) ?? 'unknown'
  const timestamp = stringValue(raw.timestamp)
  const sessionId = stringValue(raw.sessionId)
  const message = isRecord(raw.message) ? raw.message : undefined
  const messageRole = message ? stringValue(message.role) : undefined
  const content = message?.content ?? raw.content
  const baseId = idFor(raw, offset)
  const permissionMode = permissionModeFor(raw, message)
  const modeData = permissionMode ? { permissionMode } : {}

  // Only explicit protocol error records count as failures. A reply discussing
  // HTTP 503 (or a tool that exits unsuccessfully) is not an API outage.
  if (
    rawType === 'error' ||
    raw.isApiErrorMessage === true ||
    (rawType === 'system' && raw.subtype === 'api_error') ||
    (rawType === 'result' && raw.is_error === true)
  ) {
    const error = isRecord(raw.error) ? raw.error : undefined
    const detail = error && isRecord(error.error) ? error.error : error
    const text =
      contentText(content) ??
      stringValue(raw.message) ??
      stringValue(detail?.message) ??
      stringValue(raw.error) ??
      (Array.isArray(raw.errors)
        ? raw.errors.filter((value) => typeof value === 'string').join('\n')
        : undefined)
    const status = raw.statusCode ?? raw.status ?? error?.status ?? error?.statusCode
    const code =
      typeof status === 'number' || typeof status === 'string'
        ? String(status)
        : (text?.match(
            /\b(?:API Error|HTTP(?: error)?|status(?: code)?)\s*:?\s*([45]\d{2})\b/i
          )?.[1] ??
          stringValue(detail?.type) ??
          stringValue(raw.error))
    return [
      {
        id: baseId,
        sessionId,
        kind: 'error',
        timestamp,
        text,
        isError: true,
        responseError: {
          code,
          retrying: rawType === 'system' && raw.subtype === 'api_error',
          retryAfterMs: typeof raw.retryInMs === 'number' ? raw.retryInMs : undefined,
          attempt: typeof raw.retryAttempt === 'number' ? raw.retryAttempt : undefined
        },
        ...modeData,
        rawType,
        offset
      }
    ]
  }

  if (rawType === 'user' || messageRole === 'user') {
    // Claude stores native command bookkeeping as user records. These belong
    // to the terminal, not to the conversation (including embedded ANSI output).
    const nativeText = contentText(content)?.trim()
    if (nativeText && /^\[Image: source: [^\r\n]+\]$/.test(nativeText)) return []
    if (
      nativeText &&
      (/^<local-command-(caveat|stdout|stderr)>[\s\S]*<\/local-command-\1>$/.test(nativeText) ||
        /^<command-name>[\s\S]*<\/command-name>\s*<command-message>[\s\S]*<\/command-message>\s*<command-args>[\s\S]*<\/command-args>$/.test(
          nativeText
        ))
    )
      return []
    const events: TimelineEvent[] = []
    if (Array.isArray(content)) {
      content.forEach((item, index) => {
        if (!isRecord(item)) return
        if (item.type === 'tool_result') {
          events.push({
            id: `${baseId}-tool-result-${index}`,
            sessionId,
            kind: 'tool-result',
            toolCallId: stringValue(item.tool_use_id),
            timestamp,
            toolResult: item.content,
            isError: item.is_error === true,
            ...modeData,
            rawType,
            offset
          })
        }
      })
    }
    const text = contentText(content)
    if (text) {
      events.unshift({
        id: baseId,
        sessionId,
        kind: 'user',
        timestamp,
        text,
        ...modeData,
        rawType,
        offset
      })
    }
    return events.length > 0
      ? events
      : [{ id: baseId, sessionId, kind: 'user', timestamp, ...modeData, rawType, offset }]
  }

  if (rawType === 'assistant' || messageRole === 'assistant') {
    const events: TimelineEvent[] = []
    if (Array.isArray(content)) {
      const hasToolUse = content.some((item) => isRecord(item) && item.type === 'tool_use')
      content.forEach((item, index) => {
        if (!isRecord(item)) return
        if (item.type === 'text') {
          const text = stringValue(item.text)
          if (text) {
            events.push({
              id: `${baseId}-text-${index}`,
              sessionId,
              kind: 'assistant',
              isFinal: !hasToolUse && message?.stop_reason !== 'tool_use',
              timestamp,
              text,
              ...modeData,
              rawType,
              offset
            })
          }
        } else if (item.type === 'thinking') {
          const text = stringValue(item.thinking)
          if (text) {
            events.push({
              id: `${baseId}-thinking-${index}`,
              sessionId,
              kind: 'status',
              activityType: 'thinking',
              timestamp,
              text,
              ...modeData,
              rawType,
              offset
            })
          }
        } else if (item.type === 'tool_use') {
          events.push({
            id: `${baseId}-tool-${index}`,
            sessionId,
            kind: 'tool-use',
            toolCallId: stringValue(item.id),
            timestamp,
            toolName: stringValue(item.name),
            toolInput: item.input,
            ...modeData,
            rawType,
            offset
          })
        }
      })
    } else {
      const text = contentText(content)
      if (text)
        events.push({
          id: baseId,
          sessionId,
          kind: 'assistant',
          isFinal: true,
          timestamp,
          text,
          ...modeData,
          rawType,
          offset
        })
    }
    return events.length > 0
      ? events
      : [{ id: baseId, sessionId, kind: 'status', timestamp, ...modeData, rawType, offset }]
  }

  if (rawType === 'system') {
    const text = stringValue(raw.message) ?? stringValue(raw.content)
    if (!text && !permissionMode) return []
    return [
      {
        id: baseId,
        sessionId,
        kind: text ? 'system' : 'status',
        timestamp,
        ...(text ? { text } : {}),
        ...modeData,
        rawType,
        offset
      }
    ]
  }

  return permissionMode
    ? [{ id: baseId, sessionId, kind: 'status', timestamp, ...modeData, rawType, offset }]
    : []
}

export function normalizeTranscriptEvent(rawValue: unknown, offset?: number): TimelineEvent[] {
  const events = normalizeRawEvent(rawValue, offset)
  if (!isRecord(rawValue)) return events
  const message = isRecord(rawValue.message) ? rawValue.message : undefined
  const reportedModel = stringValue(message?.model)?.trim()
  const model =
    (rawValue.type === 'assistant' || message?.role === 'assistant') &&
    reportedModel &&
    !reportedModel.startsWith('<') &&
    !events.some((event) => event.isError)
      ? reportedModel
      : undefined
  return events.map((event) => ({
    ...event,
    ...(model ? { model } : {}),
    messageId: idFor(rawValue, offset),
    parentId: stringValue(rawValue.parentUuid)
  }))
}
