import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEscapeKey } from '../../src/renderer/src/use-escape-key'

function EscapeLayer({ onEscape }: { onEscape: () => void }): React.JSX.Element {
  useEscapeKey(onEscape)
  return <div />
}

describe('useEscapeKey', () => {
  it('dismisses only the most recently opened layer', () => {
    const background = vi.fn()
    const foreground = vi.fn()
    render(
      <>
        <EscapeLayer onEscape={background} />
        <EscapeLayer onEscape={foreground} />
      </>
    )

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(foreground).toHaveBeenCalledOnce()
    expect(background).not.toHaveBeenCalled()
  })
})
