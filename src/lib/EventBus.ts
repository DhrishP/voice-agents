/**
 * EventBus - A simple typed event bus for application-wide events
 *
 * This class provides a centralized event bus that any part of the application
 * can use to publish and subscribe to events.
 */

// Define a type for event handlers
type EventHandler<T = any> = (data: T) => void;

// Define the event map interface to be extended by consumers
export interface EventMap {
  [eventName: string]: any;
}

export class EventBus<T extends EventMap> {
  private static instance: EventBus<any>;
  private handlers: Map<keyof T, Set<EventHandler>>;

  private constructor() {
    this.handlers = new Map();
  }

  /**
   * Get the singleton instance of the EventBus
   */
  public static getInstance<T extends EventMap>(): EventBus<T> {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus<T>();
    }
    return EventBus.instance as EventBus<T>;
  }

  /**
   * Subscribe to an event
   * @param eventName The name of the event to subscribe to
   * @param handler The function to be called when the event is emitted
   * @returns A function that can be called to unsubscribe
   */
  public on<K extends keyof T>(
    eventName: K,
    handler: EventHandler<T[K]>
  ): () => void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }

    this.handlers.get(eventName)!.add(handler);

    // Return an unsubscribe function
    return () => {
      this.off(eventName, handler);
    };
  }

  /**
   * Unsubscribe from an event
   * @param eventName The name of the event to unsubscribe from
   * @param handler The handler to remove
   */
  public off<K extends keyof T>(
    eventName: K,
    handler: EventHandler<T[K]>
  ): void {
    if (!this.handlers.has(eventName)) {
      return;
    }

    const handlers = this.handlers.get(eventName)!;
    handlers.delete(handler);

    if (handlers.size === 0) {
      this.handlers.delete(eventName);
    }
  }

  /**
   * Emit an event with data
   * @param eventName The name of the event to emit
   * @param data The data to pass to handlers
   */
  public emit<K extends keyof T>(eventName: K, data: T[K]): void {
    if (!this.handlers.has(eventName)) {
      return;
    }

    this.handlers.get(eventName)!.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(
          `Error in event handler for ${String(eventName)}:`,
          error
        );
      }
    });
  }

  /**
   * Subscribe to an event only once
   * @param eventName The name of the event to subscribe to
   * @param handler The function to be called when the event is emitted
   */
  public once<K extends keyof T>(
    eventName: K,
    handler: EventHandler<T[K]>
  ): void {
    const onceHandler: EventHandler<T[K]> = (data: T[K]) => {
      this.off(eventName, onceHandler);
      handler(data);
    };

    this.on(eventName, onceHandler);
  }

  /**
   * Clear all handlers for a specific event
   * @param eventName The name of the event to clear handlers for
   */
  public clear<K extends keyof T>(eventName?: K): void {
    if (eventName) {
      this.handlers.delete(eventName);
    } else {
      this.handlers.clear();
    }
  }
}
