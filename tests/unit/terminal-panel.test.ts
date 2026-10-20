import { describe, expect, it } from 'vitest'
import {
  clampTerminalPanelHeight,
  MIN_TERMINAL_PANEL_HEIGHT
} from '../../src/renderer/src/panel-layout'

describe('terminal panel sizing', () => {
  it('keeps enough room for the conversation and composer', () => {
    expect(clampTerminalPanelHeight(900, 800)).toBe(600)
  })

  it('enforces the terminal minimum height', () => {
    expect(clampTerminalPanelHeight(900, 20)).toBe(MIN_TERMINAL_PANEL_HEIGHT)
  })

  it('remains usable in a short window', () => {
    expect(clampTerminalPanelHeight(360, 300)).toBe(MIN_TERMINAL_PANEL_HEIGHT)
  })
})
