import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// jsdom does not enable pretendToBeVisual by default, so requestAnimationFrame
// never fires in tests. Polyfill with setTimeout so deferred UI commits (e.g.
// the model-switch toast after the picker unmounts) resolve in tests too.
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

// Mock matchMedia (not available in jsdom)
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn()
}
if (!window.IntersectionObserver) {
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
  })
}

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
if (!window.ResizeObserver) {
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
  })
}
