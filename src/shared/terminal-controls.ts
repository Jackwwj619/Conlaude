import type { TerminalControl } from './contracts'

export const TERMINAL_CONTROL_SEQUENCES: Record<TerminalControl, string> = {
  enter: '\r',
  escape: '\u001b',
  tab: '\t',
  shiftTab: '\u001b[Z',
  arrowUp: '\u001b[A',
  arrowDown: '\u001b[B',
  arrowLeft: '\u001b[D',
  arrowRight: '\u001b[C',
  ctrlC: '\u0003',
  ctrlO: '\u000f',
  ctrlR: '\u0012',
  backspace: '\u007f',
  space: ' ',
  yes: 'y',
  no: 'n',
  one: '1',
  two: '2',
  three: '3'
}
