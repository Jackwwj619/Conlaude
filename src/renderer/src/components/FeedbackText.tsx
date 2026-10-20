import { useState } from 'react'
import { useI18n } from '../i18n'
import { CopyButton } from './CopyButton'

export function FeedbackText({ text }: { text: string }): React.JSX.Element {
  const { language } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 180 || text.split('\n').length > 3
  return (
    <div className="feedback-text">
      <p className={long && !expanded ? 'feedback-preview' : ''}>{text}</p>
      {long && (
        <div className="feedback-actions">
          <button
            className="quiet-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {language === 'zh-CN'
              ? expanded
                ? '收起详情'
                : '展开详情'
              : expanded
                ? 'Hide details'
                : 'Show details'}
          </button>
          <CopyButton
            text={text}
            label={language === 'zh-CN' ? '复制完整信息' : 'Copy full message'}
          />
        </div>
      )}
    </div>
  )
}
