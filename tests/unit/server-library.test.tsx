import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerLibrary } from '../../src/renderer/src/components/ServerLibrary'
import { useAppStore } from '../../src/renderer/src/store'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

const profile = DEFAULT_SETTINGS.profiles[0]!

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ settings: DEFAULT_SETTINGS })
})
afterEach(cleanup)

function library(onDelete = vi.fn().mockResolvedValue(undefined)) {
  return {
    onDelete,
    ...render(
      <ServerLibrary
        settings={DEFAULT_SETTINGS}
        statuses={{}}
        onOpen={vi.fn()}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
        onImport={vi.fn()}
        onDelete={onDelete}
      />
    )
  }
}

describe('server deletion', () => {
  it('requires confirmation and allows cancelling without removing a server', () => {
    const { onDelete } = library()
    fireEvent.click(screen.getByRole('button', { name: `删除服务器 ${profile.label}` }))
    expect(screen.getByRole('dialog')).toHaveTextContent(profile.label)
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('deletes by id and prevents repeat actions until the save finishes', async () => {
    let finish!: () => void
    const { onDelete } = library(
      vi.fn(
        () =>
          new Promise<void>((done) => {
            finish = done
          })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: `删除服务器 ${profile.label}` }))
    const confirm = screen.getByRole('button', { name: '删除服务器' })
    fireEvent.click(confirm)
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(profile.id)
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    finish()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps confirmation open with the save error and allows retrying', async () => {
    const onDelete = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Error invoking remote method 'profiles:remove': Save failed")
      )
      .mockResolvedValue(undefined)
    library(onDelete)
    fireEvent.click(screen.getByRole('button', { name: `删除服务器 ${profile.label}` }))
    fireEvent.click(screen.getByRole('button', { name: '删除服务器' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    fireEvent.click(screen.getByRole('button', { name: '删除服务器' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onDelete).toHaveBeenCalledTimes(2)
  })
})
