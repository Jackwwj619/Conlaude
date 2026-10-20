import { create } from 'zustand'
import { useRef, useState, type HTMLAttributes } from 'react'

const KEY = 'clb:sidebar-order:v1'
type Orders = Record<string, string[]>

export function readSidebarOrders(): Orders {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) && entry[1].every((id: unknown) => typeof id === 'string')
        )
        .map(([scope, ids]) => [scope, [...new Set(ids)]])
    )
  } catch {
    return {}
  }
}

export function orderedItems<T>(
  items: T[],
  ids: string[] | undefined,
  key: (item: T) => string
): T[] {
  if (!ids?.length) return items
  const ranks = new Map(ids.map((id, index) => [id, index]))
  return [...items].sort(
    (a, b) => (ranks.get(key(a)) ?? Infinity) - (ranks.get(key(b)) ?? Infinity)
  )
}

export function moveItem(ids: string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return ids
  const next = ids.filter((id) => id !== source)
  next.splice(next.indexOf(target) + Number(after), 0, source)
  return next
}

export const orderScope = (...parts: string[]): string => JSON.stringify(parts)

export const useSidebarOrder = create<{
  orders: Orders
  move: (scope: string, ids: string[], source: string, target: string, after: boolean) => void
}>((set) => ({
  orders: readSidebarOrders(),
  move: (scope, ids, source, target, after) =>
    set((state) => {
      const current = orderedItems(ids, state.orders[scope], (id) => id)
      const next = moveItem(current, source, target, after)
      if (next === current) return state
      const orders = { ...state.orders, [scope]: next }
      try {
        localStorage.setItem(KEY, JSON.stringify(orders))
      } catch {
        /* Keep sorting usable. */
      }
      return { orders }
    })
}))

export function useSidebarReorder() {
  const source = useRef<{ scope: string; id: string } | undefined>(undefined)
  const suppressClickUntil = useRef(0)
  const [indicator, setIndicator] = useState<{ scope: string; id: string; after: boolean }>()
  const [dragging, setDragging] = useState<string>()
  const clear = (): void => {
    source.current = undefined
    setIndicator(undefined)
    setDragging(undefined)
  }
  return (
    scope: string,
    id: string,
    ids: string[]
  ): HTMLAttributes<HTMLButtonElement> & {
    'data-drop-edge'?: string
    'data-dragging'?: boolean
  } => ({
    draggable: true,
    'data-dragging': dragging === orderScope(scope, id) || undefined,
    'data-drop-edge':
      indicator?.scope === scope && indicator.id === id
        ? indicator.after
          ? 'after'
          : 'before'
        : undefined,
    onDragStart: (event) => {
      event.stopPropagation()
      source.current = { scope, id }
      event.dataTransfer.setData('application/x-conlaude-sidebar', JSON.stringify({ scope, id }))
      event.dataTransfer.effectAllowed = 'move'
      setDragging(orderScope(scope, id))
    },
    onDragOver: (event) => {
      if (source.current?.scope !== scope || source.current.id === id) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      const bounds = event.currentTarget.getBoundingClientRect()
      setIndicator({ scope, id, after: event.clientY > bounds.top + bounds.height / 2 })
      const list = event.currentTarget.closest('.project-list')
      if (list) {
        const box = list.getBoundingClientRect()
        if (event.clientY < box.top + 32) list.scrollTop -= 12
        else if (event.clientY > box.bottom - 32) list.scrollTop += 12
      }
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIndicator(undefined)
    },
    onDrop: (event) => {
      if (source.current?.scope !== scope) return
      event.preventDefault()
      event.stopPropagation()
      const bounds = event.currentTarget.getBoundingClientRect()
      useSidebarOrder
        .getState()
        .move(scope, ids, source.current.id, id, event.clientY > bounds.top + bounds.height / 2)
      suppressClickUntil.current = performance.now() + 200
      clear()
    },
    onDragEnd: () => {
      suppressClickUntil.current = performance.now() + 200
      clear()
    },
    onClickCapture: (event) => {
      if (performance.now() < suppressClickUntil.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    onKeyDownCapture: (event) => {
      if (!event.altKey || !event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      const index = ids.indexOf(id)
      const after = event.key === 'ArrowDown'
      const target = ids[index + (after ? 1 : -1)]
      event.preventDefault()
      event.stopPropagation()
      if (target) useSidebarOrder.getState().move(scope, ids, id, target, after)
    }
  })
}

export type SidebarDragProps = ReturnType<typeof useSidebarReorder>
