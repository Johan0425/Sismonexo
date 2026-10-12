import '@testing-library/jest-dom/vitest'

// jsdom no implementa estas API del navegador.
if (!window.matchMedia)
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList
if (!('ResizeObserver' in window))
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.scrollTo ??= () => {}
