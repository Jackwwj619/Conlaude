/// <reference types="vite/client" />

import type { ClaudeBridgeApi } from '../shared/contracts'

declare global {
  interface Window {
    claudeBridge: ClaudeBridgeApi
  }
}

export {}
