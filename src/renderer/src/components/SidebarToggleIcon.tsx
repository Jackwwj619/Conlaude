export function SidebarToggleIcon({
  side
}: {
  side: 'left' | 'right' | 'bottom'
}): React.JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <rect
        x={side === 'right' ? 14.5 : 5.5}
        y={side === 'bottom' ? 13.5 : 6.5}
        width={side === 'bottom' ? 13 : 4}
        height={side === 'bottom' ? 4 : 11}
        rx="1"
        fill="currentColor"
      />
    </svg>
  )
}
