if (typeof AbortController === 'undefined') {
  type Listener = () => void;

  class AbortSignalImpl {
    aborted = false;
    onabort: Listener | null = null;
    readonly #listeners: Listener[] = [];

    addEventListener(_type: 'abort', listener: Listener, options?: { once?: boolean }) {
      if (options?.once) {
        const wrapped = () => { listener(); this.removeEventListener('abort', wrapped); };
        this.#listeners.push(wrapped);
      } else {
        this.#listeners.push(listener);
      }
    }

    removeEventListener(_type: 'abort', listener: Listener) {
      const idx = this.#listeners.indexOf(listener);
      if (idx !== -1) this.#listeners.splice(idx, 1);
    }

    dispatchAbort() {
      this.aborted = true;
      this.onabort?.();
      // Iterate a copy: once-listeners splice themselves out mid-loop
      for (const fn of [...this.#listeners]) fn();
    }
  }

  class AbortControllerImpl {
    readonly signal = new AbortSignalImpl();

    abort() {
      if (!this.signal.aborted) this.signal.dispatchAbort();
    }
  }

  (globalThis as Record<string, unknown>).AbortController = AbortControllerImpl;
  (globalThis as Record<string, unknown>).AbortSignal = AbortSignalImpl;
}
