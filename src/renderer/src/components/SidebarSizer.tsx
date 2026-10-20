import { useRef } from 'react'
import { clampSidebarWidth, useLayoutPreferences } from '../layout-preferences'
import { useI18n } from '../i18n'

export function SidebarSizer(): React.JSX.Element {
  const { language } = useI18n()
  const width = useLayoutPreferences((s) => s.sidebarWidth)
  const update = useLayoutPreferences((s) => s.update)
  const pointer = useRef<number | undefined>(undefined)
  const resize = (value: number): void =>
    update({ sidebarWidth: clampSidebarWidth(innerWidth, value) })
  return (
    <div
      className="sidebar-sash"
      role="separator"
      tabIndex={0}
      aria-label={language === 'zh-CN' ? '调整侧栏宽度' : 'Resize sidebar'}
      aria-orientation="vertical"
      aria-valuemin={190}
      aria-valuemax={clampSidebarWidth(innerWidth, 420)}
      aria-valuenow={width}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        pointer.current = e.pointerId
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (pointer.current === e.pointerId) resize(e.clientX)
      }}
      onPointerUp={(e) => {
        pointer.current = undefined
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onLostPointerCapture={() => {
        pointer.current = undefined
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') resize(width - (e.shiftKey ? 40 : 10))
        else if (e.key === 'ArrowRight') resize(width + (e.shiftKey ? 40 : 10))
        else if (e.key === 'Home') resize(190)
        else if (e.key === 'End') resize(420)
        else return
        e.preventDefault()
      }}
    />
  )
}
