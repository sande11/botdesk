import { useRef } from 'react'
import { createRateLimiter } from '../utils/security.js'

/**
 * React hook wrapping createRateLimiter.
 * The limiter instance persists for the lifetime of the component.
 */
export function useRateLimit(maxPerWindow = 15, windowMs = 60_000) {
  const limiter = useRef(createRateLimiter(maxPerWindow, windowMs))
  return {
    check: () => limiter.current.check(),
    reset: () => limiter.current.reset(),
  }
}
