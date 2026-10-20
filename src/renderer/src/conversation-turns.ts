import type { TimelineEvent } from '../../shared/contracts'
import { eventKey } from './conversation-model'

export interface ConversationTurn {
  id: string
  prompt: TimelineEvent
  events: TimelineEvent[]
}

export function splitConversationTurns(events: TimelineEvent[]): {
  leading: TimelineEvent[]
  turns: ConversationTurn[]
} {
  const leading: TimelineEvent[] = []
  const turns: ConversationTurn[] = []
  for (const event of events) {
    if (event.kind === 'user' && event.text) {
      turns.push({ id: eventKey(event), prompt: event, events: [] })
    } else {
      const turn = turns.at(-1)
      if (turn) turn.events.push(event)
      else leading.push(event)
    }
  }
  return { leading, turns }
}

export function presentTurn(turn: ConversationTurn, generating = false) {
  const final = turn.events
    .filter((event) => event.kind === 'assistant' && event.isFinal !== false && event.text?.trim())
    .at(-1)
  const lastMeaningful = final ? turn.events.indexOf(final) : -1
  const laterWork = turn.events
    .slice(lastMeaningful + 1)
    .some(
      (event) =>
        event.kind === 'tool-use' || (event.kind === 'assistant' && event.isFinal === false)
    )
  // Only explicit intermediate activity is folded. Keep every final text block
  // visible so later output cannot collapse content the user is reading.
  const replies = turn.events.filter(
    (event) => event.kind === 'assistant' && event.isFinal !== false && event.text?.trim()
  )
  const lastError = turn.events.filter((event) => event.kind === 'error').at(-1)
  const problem =
    lastError && turn.events.indexOf(lastError) > lastMeaningful ? lastError : undefined
  const replySet = new Set(replies)
  const activity = turn.events.filter((event) => !replySet.has(event) && event !== problem)
  const local = turn.prompt.turnStartedAt !== undefined
  const start = turn.prompt.turnStartedAt ?? Date.parse(turn.prompt.timestamp ?? '')
  const completed = !!final && !problem && !generating && !laterWork
  const endEvent = problem
    ? problem.responseError?.retrying
      ? undefined
      : problem
    : completed
      ? final
      : undefined
  const end =
    (!completed ? turn.prompt.turnStoppedAt : undefined) ??
    (endEvent ? (local ? endEvent.receivedAt : Date.parse(endEvent.timestamp ?? '')) : undefined)
  return {
    replies,
    activity,
    problem,
    local,
    startedAt: Number.isFinite(start) ? start : undefined,
    endedAt: end !== undefined && Number.isFinite(end) ? end : undefined,
    completed,
    stopped: !completed && turn.prompt.turnStoppedAt !== undefined,
    failed:
      (!completed && turn.prompt.localDelivery === 'failed') ||
      (!!problem && !problem.responseError?.retrying)
  }
}

export function formatTurnDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`
}
