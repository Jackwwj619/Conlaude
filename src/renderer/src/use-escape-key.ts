import { useEffect, useRef } from 'react'

type EscapeHandlerRef = { current: () => void }

const escapeHandlers: EscapeHandlerRef[] = []

function dispatchEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  const handler = escapeHandlers.at(-1)
  if (!handler) return
  event.preventDefault()
  handler.current()
}

/** Run the most recently opened dismissible layer when Escape is pressed. */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  const handlerRef = useRef(onEscape)

  useEffect(() => {
    handlerRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!enabled) return
    escapeHandlers.push(handlerRef)
    if (escapeHandlers.length === 1) window.addEventListener('keydown', dispatchEscape)

    return () => {
      const index = escapeHandlers.lastIndexOf(handlerRef)
      if (index >= 0) escapeHandlers.splice(index, 1)
      if (escapeHandlers.length === 0) window.removeEventListener('keydown', dispatchEscape)
    }
  }, [enabled])
}
