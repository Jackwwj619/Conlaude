import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

export function CopyButton({
  text,
  label,
  className = '',
  iconOnly = false,
  icon,
  children
}: {
  text: string | (() => string)
  label: string
  className?: string
  iconOnly?: boolean
  icon?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const [result, setResult] = useState<'copied' | 'failed'>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])
  const copy = async (): Promise<void> => {
    let next: 'copied' | 'failed' = 'copied'
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text)
    } catch {
      next = 'failed'
    }
    if (!mounted.current) return
    setResult(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setResult(undefined), 2200)
  }
  return (
    <span className={`copy-control ${className}`}>
      <button
        type="button"
        className="content-action"
        onClick={() => void copy()}
        aria-label={label}
        title={label}
      >
        {result === 'copied' ? <Check size={14} /> : !children && (icon ?? <Copy size={14} />)}
        {children ?? (
          <span className={iconOnly ? 'sr-only' : undefined}>
            {result === 'copied' ? t('render.copied') : label}
          </span>
        )}
      </button>
      <span role="status" className={result === 'failed' ? 'copy-error' : 'sr-only'}>
        {result === 'copied'
          ? t('render.copied')
          : result === 'failed'
            ? t('render.copyFailed')
            : ''}
      </span>
    </span>
  )
}
