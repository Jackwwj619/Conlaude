import { CircleAlert, RefreshCw } from 'lucide-react'
import type { SessionTarget } from '../../../shared/contracts'
import { targetKey, useAppStore } from '../store'
import { useI18n } from '../i18n'

export function TranscriptSyncNotice({
  target,
  connected
}: {
  target?: SessionTarget
  connected: boolean
}): React.JSX.Element | null {
  const { language } = useI18n()
  const status = useAppStore((s) => (target ? s.transcriptStatuses[targetKey(target)] : undefined))
  const setMode = useAppStore((s) => s.setWorkspaceMode)
  if (!connected || !status || !['reconnecting', 'unavailable'].includes(status.state)) return null
  const reconnecting = status.state === 'reconnecting'
  const zh = language === 'zh-CN'
  return (
    <div className="transcript-sync-notice" role="status">
      {reconnecting ? <RefreshCw size={14} className="spin" /> : <CircleAlert size={14} />}
      <span>
        {reconnecting
          ? zh
            ? '对话同步中断，正在自动恢复。远端任务仍可在终端查看。'
            : 'Conversation sync interrupted. Reconnecting; check the terminal for live output.'
          : zh
            ? '暂未找到此会话的对话记录，正在继续检查。'
            : 'Conversation history is not available yet. Checking again automatically.'}
      </span>
      <button onClick={() => setMode('split')}>{zh ? '查看终端' : 'View terminal'}</button>
    </div>
  )
}
