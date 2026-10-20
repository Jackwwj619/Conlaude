import type { TimelineEvent } from '../../shared/contracts'

export function hasVisibleTimelineContent(event: TimelineEvent): boolean {
  // Failed optimistic sends stay available for late receipt matching, not as chat history.
  if (event.id.startsWith('local-') && event.kind === 'user' && event.localDelivery === 'failed')
    return false
  // Filter presentation only: empty records may still update permissions or the reported model.
  return (
    !!event.text?.trim() ||
    event.kind === 'tool-use' ||
    event.kind === 'tool-result' ||
    event.kind === 'error' ||
    event.kind === 'unknown' ||
    event.isError === true
  )
}

const pairedCache = new WeakMap<TimelineEvent, { result: TimelineEvent; event: TimelineEvent }>()
export function pairToolEvents(events: TimelineEvent[]): TimelineEvent[] {
  const calls = new Set(
    events
      .filter((event) => event.kind === 'tool-use' && event.toolCallId)
      .map((event) => event.toolCallId)
  )
  const results = new Map(
    events
      .filter((event) => event.kind === 'tool-result' && event.toolCallId)
      .map((event) => [event.toolCallId, event])
  )
  return events.flatMap((event) => {
    if (event.kind === 'tool-result' && event.toolCallId && calls.has(event.toolCallId)) return []
    const result =
      event.kind === 'tool-use' && event.toolCallId ? results.get(event.toolCallId) : undefined
    if (!result) return [event]
    const cached = pairedCache.get(event)
    if (cached?.result === result) return [cached.event]
    const paired = {
      ...event,
      toolResult: result.toolResult,
      toolResultId: result.id,
      isError: result.isError
    }
    pairedCache.set(event, { result, event: paired })
    return [paired]
  })
}

const searchCache = new WeakMap<TimelineEvent, string>()
export function searchableEvent(event: TimelineEvent): string {
  const cached = searchCache.get(event)
  if (cached !== undefined) return cached
  const text = [event.text, event.toolName, event.rawType, event.toolInput, event.toolResult]
    .map((value) =>
      typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
    )
    .join('\n')
    .toLocaleLowerCase()
  searchCache.set(event, text)
  return text
}

export const eventKey = (event: TimelineEvent): string => event.renderId ?? event.id
