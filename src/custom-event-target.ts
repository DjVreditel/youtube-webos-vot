type TypedEventPartial<T extends EventTarget, U> = {
  readonly currentTarget: T | null;
  readonly type: U;
};

type BaseTypedEvent<T extends EventTarget, E extends Event, U> = E &
  TypedEventPartial<T, U>;

export type TypedCustomEvent<
  D,
  T extends EventTarget,
  U = string
> = BaseTypedEvent<T, CustomEvent<D>, U>;

export const TypedCustomEvent = CustomEvent as {
  new <const U extends string, const D = undefined>(
    type: U,
    eventInitDict?: CustomEventInit<D>
  ): TypedCustomEvent<D, EventTarget, U>;

  prototype: BaseTypedEvent<EventTarget, CustomEvent<unknown>, string>;
};

interface EmptyEventMap {}

type EventMapValue<
  T extends EmptyEventMap,
  K extends keyof T & string
> = T[K] extends Event ? T[K] : never;

interface EventListener<
  Self extends EventTarget,
  T extends EmptyEventMap,
  EventName extends keyof T
> {
  (this: Self, evt: T[EventName] & TypedEventPartial<Self, EventName>): void;
}

interface EventListenerObject<
  Self extends EventTarget,
  T extends EmptyEventMap,
  EventName extends keyof T
> {
  handleEvent: EventListener<Self, T, EventName>;
}

type EventListenerArg<
  Self extends EventTarget,
  T extends EmptyEventMap,
  EventName extends keyof T
> =
  | EventListener<Self, T, EventName>
  | EventListenerObject<Self, T, EventName>
  | null;

interface CustomEventTarget<T extends EmptyEventMap> {
  addEventListener<K extends keyof T & string>(
    type: K,
    callback: EventListenerArg<this, T, K>,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof T & string>(
    type: K,
    callback: EventListenerArg<this, T, K>,
    options?: boolean | EventListenerOptions
  ): void;

  dispatchEvent<K extends keyof T & string>(
    event: EventMapValue<T, K>
  ): boolean;
}

/**
 * `new EventTarget()` only works from Chrome 64. On webOS 3-6 (Chrome 38-79)
 * it throws "Illegal constructor", which took FetchRegistry - and with it the
 * Tracking Block's request hook - down on the legacy build. This minimal
 * stand-in covers what the registry uses: add/remove and a synchronous
 * dispatch that reports preventDefault().
 */
class EventTargetShim {
  private readonly listenerMap = new Map<string, any[]>();

  addEventListener(type: string, callback: any): void {
    if (!callback) return;
    const list = this.listenerMap.get(type) || [];
    if (list.indexOf(callback) === -1) list.push(callback);
    this.listenerMap.set(type, list);
  }

  removeEventListener(type: string, callback: any): void {
    const list = this.listenerMap.get(type);
    if (!list) return;
    const at = list.indexOf(callback);
    if (at !== -1) list.splice(at, 1);
  }

  dispatchEvent(event: Event): boolean {
    const list = this.listenerMap.get(event.type);
    if (list) {
      // A snapshot, as a real EventTarget runs listeners: one removed or
      // added during the dispatch does not change this round.
      for (const callback of list.slice()) {
        try {
          if (typeof callback === 'function') callback.call(this, event);
          else if (callback && typeof callback.handleEvent === 'function') callback.handleEvent(event);
        } catch (err) {
          console.error('[CustomEventTarget] listener failed', err);
        }
      }
    }
    return !event.defaultPrevented;
  }
}

function isEventTargetConstructible() {
  try {
    new EventTarget();
    return true;
  } catch {
    return false;
  }
}

const EventTargetBase: typeof EventTarget = isEventTargetConstructible()
  ? EventTarget
  : (EventTargetShim as unknown as typeof EventTarget);

export const CustomEventTarget = EventTargetBase as {
  new <T extends EmptyEventMap>(): CustomEventTarget<T>;
  prototype: CustomEventTarget<EmptyEventMap>;
};

export type EventMapOf<T> =
  T extends CustomEventTarget<infer U>
    ? { [K in keyof U]: U[K] & TypedEventPartial<T, K> }
    : never;