import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionActionDialog } from '../../src/renderer/src/components/SessionActionDialog'

const target = { profileId: 'mas', sessionName: 'claude-mas' }

describe('SessionActionDialog', () => {
  it('requires the exact session name before termination', async () => {
    const terminate = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionActionDialog
        action="terminate"
        target={target}
        onClose={() => undefined}
        onRename={async () => undefined}
        onTerminate={terminate}
      />
    )

    const button = screen.getByRole('button', { name: '终止远端会话' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('会话名确认'), { target: { value: 'wrong' } })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText('会话名确认'), { target: { value: 'claude-mas' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(terminate).toHaveBeenCalledWith('claude-mas'))
  })

  it('validates and submits a new tmux name', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionActionDialog
        action="rename"
        target={target}
        onClose={() => undefined}
        onRename={rename}
        onTerminate={async () => undefined}
      />
    )

    const input = screen.getByLabelText('新会话名')
    const button = screen.getByRole('button', { name: '保存名称' })
    fireEvent.change(input, { target: { value: 'bad name' } })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: 'claude-next' } })
    fireEvent.click(button)
    await waitFor(() => expect(rename).toHaveBeenCalledWith('claude-next'))
  })
})
