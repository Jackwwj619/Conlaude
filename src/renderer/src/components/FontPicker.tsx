import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { interfaceFontFamily, terminalFontFamily } from '../../../shared/font-presets'
import { translate } from '../../../shared/i18n'
import type { AppLanguage } from '../../../shared/contracts'

interface Props {
  id: string
  label: string
  value: string
  language: AppLanguage
  terminal?: boolean
  fonts: string[]
  loading: boolean
  error: boolean
  options: ReadonlyArray<{ value: string; labelKey: string }>
  onChange: (value: string) => void
  onRefresh: () => void
}

export function FontPicker(props: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, height: 280 })
  const [host, setHost] = useState<Element | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const t = (key: string, variables?: Record<string, string | number>): string =>
    translate(props.language, key, variables)
  const label = (zh: string, en: string): string => (props.language === 'zh-CN' ? zh : en)
  const family = props.terminal ? terminalFontFamily : interfaceFontFamily
  const selectedLabel = props.value.startsWith('local:')
    ? props.value.slice(6)
    : t(props.options.find((option) => option.value === props.value)?.labelKey ?? props.value)
  const options = useMemo(() => {
    const presets = props.options.map((option) => ({
      value: option.value,
      label: translate(props.language, option.labelKey),
      group: 'preset'
    }))
    const names = new Set(props.fonts.map((name) => name.toLocaleLowerCase()))
    const keptPresets = presets.filter(
      (option) => option.value === props.value || !names.has(option.label.toLocaleLowerCase())
    )
    const known = new Set(keptPresets.map((option) => option.label.toLocaleLowerCase()))
    const local = [...new Set(props.fonts)]
      .filter((name) => !known.has(name.toLocaleLowerCase()))
      .map((name) => ({ value: `local:${name}`, label: name, group: 'local' }))
    const match = query.trim().toLocaleLowerCase()
    return [...keptPresets, ...local].filter((option) =>
      option.label.toLocaleLowerCase().includes(match)
    )
  }, [props.options, props.fonts, props.language, props.value, query])
  const missing =
    props.value.startsWith('local:') &&
    !props.loading &&
    !props.fonts.includes(props.value.slice(6))
  const close = (): void => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }
  const choose = (value: string): void => {
    props.onChange(value)
    close()
    input.current?.focus()
  }
  const begin = (): void => {
    setHost(input.current?.closest('[role="dialog"]') ?? document.body)
    setQuery('')
    setActive(0)
    setScrollTop(0)
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = input.current!.getBoundingClientRect()
      const below = innerHeight - rect.bottom - 8
      const above = rect.top - 8
      const height = Math.min(320, Math.max(below, above))
      setPosition({
        left: Math.max(8, Math.min(rect.left, innerWidth - Math.max(rect.width, 250) - 8)),
        top: below >= Math.min(250, height) ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
        width: Math.min(Math.max(rect.width, 250), innerWidth - 16),
        height
      })
    }
    const outside = (event: PointerEvent): void => {
      if (!popup.current?.contains(event.target as Node) && event.target !== input.current) {
        setOpen(false)
        setQuery('')
      }
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (!composing.current && !event.isComposing) {
        setOpen(false)
        setQuery('')
      }
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    const observer = new ResizeObserver(place)
    observer.observe(input.current!)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open])
  const start = Math.max(0, Math.floor(scrollTop / 52) - 3)
  const visible = options.slice(start, start + 16)
  return (
    <div className="font-picker">
      <div className="font-combobox">
        <input
          id={props.id}
          ref={input}
          role="combobox"
          aria-label={props.label}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={`${props.id}-options`}
          aria-activedescendant={
            open && options[active] && active >= start && active < start + 16
              ? `${props.id}-option-${active}`
              : undefined
          }
          value={open ? query : selectedLabel}
          placeholder={selectedLabel}
          autoComplete="off"
          onClick={() => {
            if (!open) begin()
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setScrollTop(0)
            if (list.current) list.current.scrollTop = 0
            if (!open) {
              setHost(input.current?.closest('[role="dialog"]') ?? document.body)
              setOpen(true)
            }
          }}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onBlur={(event) => {
            if (!popup.current?.contains(event.relatedTarget as Node)) close()
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault()
              if (!open) {
                begin()
                return
              }
              const next = Math.max(
                0,
                Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))
              )
              setActive(next)
              if (list.current) {
                const top = next * 52
                if (
                  top < list.current.scrollTop ||
                  top + 52 > list.current.scrollTop + list.current.clientHeight
                )
                  list.current.scrollTop = top
              }
            } else if (event.key === 'Enter' && open) {
              event.preventDefault()
              event.stopPropagation()
              if (options[active]) choose(options[active].value)
            } else if (event.key === 'Tab') close()
          }}
        />
        <ChevronDown size={14} aria-hidden="true" />
      </div>
      {missing && (
        <small className="font-picker-hint">
          {label(
            '当前字体不可用，保留原值并使用回退字体。',
            'Selected font is unavailable; its value is preserved with a fallback.'
          )}
        </small>
      )}
      {open &&
        host &&
        createPortal(
          <div
            className="font-popup"
            ref={popup}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="font-popup-status">
              <small role="status">
                {t(props.loading ? 'fonts.loading' : props.error ? 'fonts.failed' : 'fonts.count', {
                  count: props.fonts.length
                })}
              </small>
              <button
                type="button"
                className="icon-button"
                disabled={props.loading}
                aria-label={`${props.label} · ${t('fonts.refresh')}`}
                onClick={props.onRefresh}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {props.terminal && (
              <small className="font-picker-hint">{t('fonts.monospaceHint')}</small>
            )}
            {!options.length && <p role="status">{t('fonts.noResults')}</p>}
            <div
              ref={list}
              id={`${props.id}-options`}
              role="listbox"
              aria-label={props.label}
              className="font-options"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div style={{ height: options.length * 52, position: 'relative' }}>
                {visible.map((option, index) => (
                  <div
                    key={option.value}
                    data-value={option.value}
                    title={option.label}
                    id={`${props.id}-option-${start + index}`}
                    role="option"
                    aria-selected={props.value === option.value}
                    aria-posinset={start + index + 1}
                    aria-setsize={options.length}
                    className={`font-option ${active === start + index ? 'active' : ''}`}
                    style={{ top: (start + index) * 52 }}
                    onMouseMove={() => setActive(start + index)}
                    onClick={() => choose(option.value)}
                  >
                    <span>
                      {option.label}
                      <small>
                        {option.group === 'preset'
                          ? t('fonts.presets')
                          : label('本机字体', 'Installed')}
                      </small>
                    </span>
                    <span className="font-sample" style={{ fontFamily: family(option.value) }}>
                      中文 Aa 012
                    </span>
                    {props.value === option.value && <Check size={14} />}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          host
        )}
    </div>
  )
}
