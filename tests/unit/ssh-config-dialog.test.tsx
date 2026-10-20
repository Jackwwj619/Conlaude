import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SshConfigDialog } from '../../src/renderer/src/components/SshConfigDialog'

describe('SshConfigDialog', () => {
  const getSshConfig = vi.fn()
  const saveSshConfig = vi.fn()

  beforeEach(() => {
    getSshConfig.mockResolvedValue({
      path: 'C:\\Users\\test\\.ssh\\config',
      content: 'Host mas\n  HostName 203.0.113.10\n',
      entries: [{ host: 'mas', hostName: '203.0.113.10' }]
    })
    saveSshConfig.mockResolvedValue({
      path: 'C:\\Users\\test\\.ssh\\config',
      content: 'Host mas\n  User ubuntu\n',
      entries: [{ host: 'mas', user: 'ubuntu' }]
    })
    vi.stubGlobal('claudeBridge', { profiles: { getSshConfig, saveSshConfig } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    getSshConfig.mockReset()
    saveSshConfig.mockReset()
  })

  it('loads and saves ~/.ssh/config through the privileged API', async () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<SshConfigDialog onClose={onClose} onSaved={onSaved} />)

    const editor = await screen.findByLabelText('配置内容')
    expect(editor).toHaveValue('Host mas\n  HostName 203.0.113.10\n')
    fireEvent.change(editor, { target: { value: 'Host mas\n  User ubuntu\n' } })
    fireEvent.click(screen.getByRole('button', { name: '保存到 ~/.ssh/config' }))

    await waitFor(() => expect(saveSshConfig).toHaveBeenCalledWith('Host mas\n  User ubuntu\n'))
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [{ host: 'mas', user: 'ubuntu' }] })
    )
    expect(onClose).toHaveBeenCalledOnce()
  })
})
