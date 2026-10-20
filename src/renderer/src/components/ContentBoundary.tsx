import { Component, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { CopyButton } from './CopyButton'

function Fallback({ source }: { source: string }): React.JSX.Element {
  const { language } = useI18n()
  return (
    <div className="content-fallback">
      <small role="status">
        {language === 'zh-CN'
          ? '排版暂不可用，原文已保留。'
          : 'Formatting is unavailable. Original text is preserved.'}
      </small>
      <pre>{source}</pre>
      <CopyButton text={source} label={language === 'zh-CN' ? '复制原文' : 'Copy original text'} />
    </div>
  )
}
export class ContentBoundary extends Component<
  { source: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render(): ReactNode {
    return this.state.failed ? <Fallback source={this.props.source} /> : this.props.children
  }
}
