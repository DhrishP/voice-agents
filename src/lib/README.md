# TypeScript Event Bus

This is a simple, type-safe event bus implementation for TypeScript applications. It allows any part of your application to publish and subscribe to events in a decoupled manner.

## Features

- **Type-safe events**: Define your event types and get full TypeScript support
- **Singleton pattern**: One central event bus for your application
- **Simple API**: Easy to use with on/off/emit methods
- **Error handling**: Safely catches errors in event handlers
- **One-time events**: Support for one-time event subscriptions
- **Unsubscribe functions**: Clean way to remove event listeners

## Usage

### Basic Setup

First, define your application's event types:

```typescript
// events.ts
import { EventMap } from "./EventBus";

export interface AppEvents extends EventMap {
  "user:login": { userId: string; username: string };
  "cart:updated": { items: number; total: number };
  notification: { message: string; type: "error" | "warning" | "info" };
}
```

### Publishing Events

To emit events from any component/file:

```typescript
// userService.ts
import { EventBus } from "./EventBus";
import { AppEvents } from "./events";

const eventBus = EventBus.getInstance<AppEvents>();

function loginUser(username: string, password: string) {
  // Authentication logic
  // ...

  // On successful login, emit event
  eventBus.emit("user:login", {
    userId: "user_123",
    username: username,
  });
}
```

### Subscribing to Events

To listen for events from any component/file:

```typescript
// dashboard.ts
import { EventBus } from "./EventBus";
import { AppEvents } from "./events";

const eventBus = EventBus.getInstance<AppEvents>();

// Listen for login events
const unsubscribe = eventBus.on("user:login", (userData) => {
  console.log(`Welcome back, ${userData.username}!`);
  updateDashboard(userData.userId);
});

// When component unmounts or no longer needs the event
function cleanup() {
  unsubscribe();
}
```

### One-time Events

For events you only need to handle once:

```typescript
eventBus.once("notification", (data) => {
  showToast(data.message, data.type);
});
```

### Global Instance

You can also use the pre-exported global instance, but you'll need to cast it to your event types:

```typescript
import { eventBus } from "./EventBus";
import { AppEvents } from "./events";

const typedEventBus = eventBus as unknown as EventBus<AppEvents>;

typedEventBus.emit("notification", {
  message: "Hello world",
  type: "info",
});
```

## Best Practices

1. **Organize event names**: Use namespaced event names (e.g., 'user:login', 'data:loaded')
2. **Define type interfaces**: Create a centralized event type definition for your application
3. **Clean up subscriptions**: Always unsubscribe when components are destroyed
4. **Error handling**: The event bus catches errors in handlers, but use try/catch in critical sections

## Implementation Details

The event bus uses a singleton pattern to ensure there's only one event bus instance across your application. It stores event handlers in a Map and uses Sets to manage multiple handlers for the same event type.
