import '@testing-library/jest-dom/vitest'

// jsdom has no layout engine; components may request scrolling after validation.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: () => undefined
  })
}
