import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  moveItem,
  orderedItems,
  orderScope,
  readSidebarOrders,
  useSidebarOrder
} from '../../src/renderer/src/sidebar-order'

describe('custom sidebar order', () => {
  beforeEach(() => {
    localStorage.clear()
    useSidebarOrder.setState({ orders: {} })
  })

  it('persists moves while keeping other servers and directories independent', () => {
    const one = orderScope('sessions', 'server-a', '/project')
    const two = orderScope('sessions', 'server-b', '/project')
    useSidebarOrder.getState().move(one, ['a', 'b', 'c'], 'c', 'a', false)
    useSidebarOrder.getState().move(two, ['a', 'b', 'c'], 'a', 'c', true)
    expect(readSidebarOrders()).toEqual({ [one]: ['c', 'a', 'b'], [two]: ['b', 'c', 'a'] })
    expect(orderedItems(['a', 'new', 'b', 'c'], readSidebarOrders()[one], String)).toEqual([
      'c',
      'a',
      'b',
      'new'
    ])
  })

  it('retains hidden siblings and manual order after source refreshes', () => {
    useSidebarOrder.getState().move('servers', ['a', 'hidden', 'b', 'c'], 'c', 'a', false)
    useSidebarOrder.getState().move('servers', ['a', 'hidden', 'b', 'c'], 'b', 'a', false)
    const order = readSidebarOrders().servers
    expect(order).toEqual(['c', 'b', 'a', 'hidden'])
    expect(orderedItems(['a', 'c'], order, String)).toEqual(['c', 'a'])
    expect(orderedItems(['hidden', 'a', 'b', 'c'], order, String)).toEqual(order)
  })

  it('ignores invalid moves and safely reads damaged preferences', () => {
    const ids = ['a', 'b']
    expect(moveItem(ids, 'missing', 'b', true)).toBe(ids)
    expect(moveItem(ids, 'a', 'a', false)).toBe(ids)
    localStorage.setItem('clb:sidebar-order:v1', '{invalid')
    expect(readSidebarOrders()).toEqual({})
    localStorage.setItem(
      'clb:sidebar-order:v1',
      JSON.stringify({ bad: [1], valid: ['a', 'a', 'b'] })
    )
    expect(readSidebarOrders()).toEqual({ valid: ['a', 'b'] })
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Error('full')
    })
    useSidebarOrder.getState().move('servers', ids, 'b', 'a', false)
    expect(useSidebarOrder.getState().orders.servers).toEqual(['b', 'a'])
    failure.mockRestore()
  })
})
