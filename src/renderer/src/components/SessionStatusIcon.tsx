import {
  Activity,
  Circle,
  CircleCheck,
  CircleHelp,
  Clock3,
  Eye,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  Unplug,
  type LucideIcon
} from 'lucide-react'

const indicators: Record<string, { icon: LucideIcon; tone: string; spinning?: boolean }> = {
  'status.checking': { icon: LoaderCircle, tone: 'active', spinning: true },
  'status.connecting': { icon: LoaderCircle, tone: 'active', spinning: true },
  'status.reconnecting': { icon: RefreshCw, tone: 'warning', spinning: true },
  'status.attached': { icon: CircleCheck, tone: 'success' },
  'status.failed': { icon: TriangleAlert, tone: 'danger' },
  'status.detached': { icon: Unplug, tone: 'muted' },
  'work.readOnly': { icon: Eye, tone: 'muted' },
  'work.confirmation': { icon: CircleHelp, tone: 'warning' },
  'work.checking': { icon: LoaderCircle, tone: 'active', spinning: true },
  'work.recordPending': { icon: Clock3, tone: 'muted' },
  'work.replyPending': { icon: Clock3, tone: 'active' },
  'work.reply': { icon: CircleCheck, tone: 'success' },
  'work.output': { icon: Activity, tone: 'active' },
  'work.ready': { icon: CircleCheck, tone: 'success' },
  'composer.generatingStatus': { icon: LoaderCircle, tone: 'active', spinning: true }
}

/** A stable-width status slot; its meaning remains available without relying on color. */
export function SessionStatusIcon({
  activity,
  label,
  className = ''
}: {
  activity: string
  label: string
  className?: string
}): React.JSX.Element {
  const { icon: Icon, tone, spinning } = indicators[activity] ?? { icon: Circle, tone: 'muted' }
  return (
    <span
      className={`session-status-icon ${className}`}
      role="img"
      aria-label={label}
      title={label}
      data-tone={tone}
      data-spinning={spinning || undefined}
    >
      <Icon size={14} aria-hidden="true" />
    </span>
  )
}
