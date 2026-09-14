import '@testing-library/jest-dom/vitest';

// jsdom ships neither matchMedia nor ResizeObserver; the shell and the virtual
// table need both. Minimal stubs — enough to render, never enough to lie about
// what the browser would do.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom yerleşim hesaplamadığı için scrollIntoView'ı hiç tanımlamaz.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
