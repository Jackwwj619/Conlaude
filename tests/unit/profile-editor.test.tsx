import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileEditor } from '../../src/renderer/src/components/ProfileEditor'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  vi.stubGlobal('claudeBridge', {
    profiles: { getSshConfig: vi.fn().mockResolvedValue({ entries: [{ host: 'exp' }] }) }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('server editor', () => {
  it('creates a usable SSH alias profile with a stable generated id', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ProfileEditor onSave={onSave} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '保存服务器' }))
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('服务器名称'), { target: { value: '实验服务器' } })
    fireEvent.change(screen.getByLabelText('OpenSSH Host', { exact: false }), {
      target: { value: 'exp' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存服务器' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          label: '实验服务器',
          sshHost: 'exp',
          host: 'exp',
          claudePath: 'cc'
        })
      )
    )
  })

  it('removes the alias when switching to manual connection settings', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ProfileEditor profile={DEFAULT_SETTINGS.profiles[0]} onSave={onSave} onClose={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: '手动配置' }))
    fireEvent.change(screen.getByLabelText('主机 (Host)'), { target: { value: '10.0.0.2' } })
    fireEvent.click(screen.getByRole('button', { name: '保存服务器' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ sshHost: undefined, host: '10.0.0.2' })
      )
    )
  })

  it('keeps the editor open with an actionable error when a live endpoint cannot change', async () => {
    const onClose = vi.fn()
    render(
      <ProfileEditor
        profile={DEFAULT_SETTINGS.profiles[0]}
        onSave={vi.fn().mockRejectedValue(new Error('请先分离连接'))}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '保存服务器' }))
    await expect(screen.findByRole('alert')).resolves.toHaveTextContent('请先分离连接')
    expect(onClose).not.toHaveBeenCalled()
  })
})
