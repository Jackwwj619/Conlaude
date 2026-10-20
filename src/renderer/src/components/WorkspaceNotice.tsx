import { CircleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { FeedbackText } from './FeedbackText'

/** Dismissal lasts only for this mounted occurrence, never across visits or restarts. */
export function WorkspaceNotice({
  title,
  body,
  level = '',
  action,
  onAction
}: {
  title: string
  body: string
  level?: string
  action?: string
  onAction?: () => void
}): React.JSX.Element | null {
  const { language } = useI18n()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  const dismissLabel = language === 'zh-CN' ? '关闭此提示' : 'Dismiss notice'
  return (
    <div className={`workspace-notice ${level}`} role={level === 'error' ? 'alert' : 'status'}>
      <CircleAlert size={17} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <FeedbackText text={body} />
      </div>
      {action && (
        <button className="secondary-button" onClick={onAction}>
          {action}
        </button>
      )}
      <button
        className="icon-button workspace-notice-dismiss"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={() => setDismissed(true)}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
