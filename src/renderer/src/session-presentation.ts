import type { SessionStatus, TimelineEvent } from '../../shared/contracts'

/** Connection, terminal readiness and observed output are different facts. */
export function sessionActivity(status?: SessionStatus, events: TimelineEvent[] = []): string {
  if (!status || status.state !== 'attached') return `status.${status?.state ?? 'idle'}`
  if (status.readOnly) return 'work.readOnly'
  if (status.promptState === 'confirmation') return 'work.confirmation'
  if (status.generating) return 'composer.generatingStatus'
  if (status.promptState !== 'ready') return 'work.checking'
  const last = events.findLast((event) => event.localDelivery !== 'failed')
  if (last?.kind === 'user')
    return last.id.startsWith('local-') ? 'work.recordPending' : 'work.replyPending'
  if (last?.kind === 'assistant' && last.isFinal !== false && last.text) return 'work.reply'
  if (last?.kind === 'tool-use' || last?.kind === 'tool-result') return 'work.output'
  return 'work.ready'
}
