import '@testing-library/jest-dom/vitest';

// jsdom in this vitest setup does not expose localStorage unless a persistence
// file is configured. Provide a minimal in-memory polyfill so existing tests
// that clear/read localStorage can run without network or disk access.
if (typeof window.localStorage === 'undefined') {
  const store = {};
  window.localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index) => Object.keys(store)[index] || null,
  };
}
