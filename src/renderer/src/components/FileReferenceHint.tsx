import { useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Portal keeps long path hints clear of the conversation scroll container. */
export function FileReferenceHint({
  path,
  children
}: {
  path: string
  children: ReactNode
}): React.JSX.Element {
  const id = useId()
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean }>()
  const show = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect()
    const half = Math.min(420, window.innerWidth - 24) / 2
    setPosition({
      left: Math.max(
        half + 12,
        Math.min(window.innerWidth - half - 12, rect.left + rect.width / 2)
      ),
      top: rect.top > 90 ? rect.top - 8 : rect.bottom + 8,
      above: rect.top > 90
    })
  }
  return (
    <span
      className="file-reference"
      aria-describedby={position ? id : undefined}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setPosition(undefined)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setPosition(undefined)}
      onClick={() => setPosition(undefined)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setPosition(undefined)
      }}
    >
      {children}
      {position &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="file-reference-tooltip"
            style={{
              left: position.left,
              top: position.top,
              transform: position.above ? 'translate(-50%, -100%)' : 'translateX(-50%)'
            }}
          >
            {path}
          </span>,
          document.body
        )}
    </span>
  )
}
