import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../../src/renderer/src/components/SettingsDialog'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'
const setup = (
  onSave = vi.fn().mockResolvedValue(undefined),
  settings = structuredClone(DEFAULT_SETTINGS)
) => {
  const onClose = vi.fn()
  render(<SettingsDialog settings={settings} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
}
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('claudeBridge', {
    app: { listFonts: vi.fn().mockResolvedValue(['Consolas', '宋体']) },
    profiles: { getSshConfig: vi.fn().mockResolvedValue({ content: '', entries: [] }) }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('settings preferences', () => {
  it('saves preferences immediately without closing or changing server configuration', async () => {
    const { onSave, onClose } = setup()
    fireEvent.click(screen.getByLabelText('关闭窗口时保留在托盘'))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ closeToTray: true, profiles: DEFAULT_SETTINGS.profiles })
      )
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })
  it('locates search results and commits numeric values only after validation', async () => {
    const { onSave } = setup()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'font size' } })
    fireEvent.click(screen.getByRole('button', { name: /回复字号/ }))
    const number = screen.getByLabelText('回复字号')
    fireEvent.change(number, { target: { value: '' } })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.blur(number)
    expect(number).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(number, { target: { value: '20' } })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.blur(number)
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ conversation: expect.objectContaining({ fontSize: 20 }) })
      )
    )
  })
  it('serializes rapid updates and retains the latest values', async () => {
    let finish!: () => void
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(undefined)
    setup(save)
    fireEvent.click(screen.getByLabelText('关闭窗口时保留在托盘'))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByLabelText('Claude 等待输入或发生错误时发送 Windows 通知'))
    finish()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ closeToTray: true, notifications: false })
    )
  })
  it('keeps failed changes and retries the same preference values', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('磁盘不可写')).mockResolvedValue(undefined)
    const { onClose } = setup(save)
    fireEvent.click(screen.getByLabelText('关闭窗口时保留在托盘'))
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘不可写')
    expect(screen.getByLabelText('关闭窗口时保留在托盘')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(onClose).not.toHaveBeenCalled()
  })
  it('restores only one category and requires confirmation before pruning history', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.conversation.fontSize = 20
    settings.terminal.fontSize = 22
    const { onSave } = setup(undefined, settings)
    fireEvent.click(screen.getByRole('button', { name: '外观' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复本页默认值' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation: expect.objectContaining({ fontSize: 14 }),
          terminal: expect.objectContaining({ fontSize: 14 })
        })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: '输入与发送' }))
    fireEvent.click(screen.getByText('高级', { selector: 'summary' }))
    const limit = await screen.findByLabelText('每个会话保留的输入历史条数')
    fireEvent.change(limit, { target: { value: '1' } })
    fireEvent.blur(limit)
    expect(onSave).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '常规' }))
    fireEvent.click(screen.getByLabelText('关闭窗口时保留在托盘'))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '应用并清理' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3))
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        closeToTray: true,
        composer: expect.objectContaining({ historyLimit: 1 })
      })
    )
  })
  it('saves server edits explicitly in a single editor and preserves other profiles', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.profiles.push({ ...settings.profiles[0]!, id: 'second', label: 'Second' })
    const { onSave } = setup(undefined, settings)
    fireEvent.click(screen.getByRole('button', { name: '服务器' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: '编辑服务器与会话默认值' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('服务器名称'), { target: { value: 'Updated' } })
    fireEvent.click(screen.getByRole('button', { name: '保存服务器' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          profiles: [
            settings.profiles[0],
            expect.objectContaining({ id: 'second', label: 'Updated' })
          ]
        })
      )
    )
  })
  it('keeps connection tools available without any servers', () => {
    setup(undefined, { ...DEFAULT_SETTINGS, profiles: [], currentProfileId: '' })
    fireEvent.click(screen.getByRole('button', { name: '服务器' }))
    expect(screen.queryByLabelText('服务器配置')).toBeNull()
    expect(screen.getByRole('button', { name: '编辑 ~/.ssh/config' })).toBeEnabled()
  })
})
