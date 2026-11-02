import type { MuotApi } from '../electron/preload'

declare global {
  interface Window {
    muot: MuotApi
  }
}

export {}
