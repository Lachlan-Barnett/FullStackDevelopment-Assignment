// Runs before every spec file.
//
// Newer Node versions (25+) ship their own global `localStorage`, which is undefined unless Node
// is started with --localstorage-file. It hides jsdom's working one, so AuthService and the dark
// mode code crash in tests. Swap in a simple in-memory Storage when that happens.

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

if (typeof globalThis.localStorage?.getItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true });
}

// Each test starts logged out with default settings.
beforeEach(() => localStorage.clear());
