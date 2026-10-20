import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { FontPicker } from '../../src/renderer/src/components/FontPicker'
const changed = vi.fn()
function Picker({
  error = false,
  fonts = ['Consolas', '思源黑体 CN', '宋体'],
  initial = 'system'
}: {
  error?: boolean
  fonts?: string[]
  initial?: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <FontPicker
      id="font"
      label="界面字体"
      value={value}
      language="zh-CN"
      fonts={fonts}
      loading={false}
      error={error}
      options={[{ value: 'system', labelKey: 'settings.interfaceFontSystem' }]}
      onChange={(next) => {
        changed(next)
        setValue(next)
      }}
      onRefresh={changed}
    />
  )
}
beforeEach(() => {
  changed.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('font combobox', () => {
  it('separates query from selection and restores the original value on Escape or blur', () => {
    render(<Picker />)
    const input = screen.getByRole('combobox')
    const initial = (input as HTMLInputElement).value
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Consolas' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(changed).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue(initial)
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'no match' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(initial)
    expect(changed).not.toHaveBeenCalled()
  })
  it('ignores IME confirmation and commits keyboard and mouse choices identically', () => {
    render(<Picker />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '宋体' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(changed).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(changed).toHaveBeenLastCalledWith('local:宋体')
    expect(input).toHaveValue('宋体')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Consolas' } })
    fireEvent.click(screen.getByRole('option'))
    expect(changed).toHaveBeenLastCalledWith('local:Consolas')
  })
  it('keeps missing values on discovery failure without adding false search matches', () => {
    render(<Picker error initial="local:Missing Font" />)
    const input = screen.getByRole('combobox')
    expect(input).toHaveValue('Missing Font')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'no match' } })
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByText(/读取失败/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /刷新字体/ }))
    expect(changed).toHaveBeenCalledOnce()
  })
  it('limits rendered candidates while keeping the complete catalog searchable', () => {
    render(<Picker fonts={Array.from({ length: 1200 }, (_, i) => `Family ${i}`)} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(16)
    fireEvent.change(input, { target: { value: 'Family 1199' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(changed).toHaveBeenLastCalledWith('local:Family 1199')
  })
})
