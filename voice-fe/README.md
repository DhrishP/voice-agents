# Voice AI WebSocket Demo

This is a demonstration of the WebSocket-based telephony provider for InducedAI's voice agent platform. Instead of making real phone calls, this provider enables voice communication directly through a WebSocket connection in a web browser.

## Features

- Real-time voice communication with an AI agent
- Audio recording and playback directly in the browser
- Call state management and duration tracking
- Event-based architecture for handling audio and call events
- Configurable AI providers and models
- TypeScript support with full type definitions

## Getting Started

### Prerequisites

- Node.js (18.x or higher recommended)
- Backend server running the InducedAI voice platform

### Installation

1. Clone the repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env.local` file with:

   ```
   NEXT_PUBLIC_BACKEND_URL=http://localhost:3033
   NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:3033
   ```

   Adjust the URLs to match your backend server.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## How It Works

1. The frontend initiates a call using the `useInducedVoice` hook
2. The backend creates a call session and returns a unique call ID
3. A WebSocket connection is automatically established using this call ID
4. Audio is streamed bidirectionally between the browser and the AI voice agent
5. The AI agent processes the audio, generates responses, and sends them back to the browser

## Hook API

### useInducedVoice

The main hook for managing voice calls with the AI assistant.

```typescript
const {
  callState, // CallState - current state of the call (IDLE, CONNECTING, CONNECTED, etc.)
  callDuration, // number - duration of the call in seconds
  hangup, // () => void - function to end the call
  pipe, // (data: string) => boolean - send audio data to the AI
  on, // (event: EventType, callback: (data: any) => void) => () => void
  startCall, // (options?: CreateCallOptions) => Promise<void>
  isLoading, // boolean - whether a call is being initiated
} = useInducedVoice();
```

#### Call States

```typescript
enum CallState {
  IDLE = "idle", // Initial state before any call
  CONNECTING = "connecting", // Call is being established
  CONNECTED = "connected", // Call is active
  ENDED = "ended", // Call has been terminated
  ERROR = "error", // An error occurred
}
```

#### Events

```typescript
type EventType =
  | "audio.out" // Emitted when audio is received from the server
  | "call.started" // Emitted when a call begins
  | "call.ended" // Emitted when a call ends
  | "error" // Emitted when an error occurs
  | "call.audio.cancelled"; // Emitted when audio playback is cancelled
```

#### Usage Example

```typescript
const { callState, callDuration, hangup, pipe, on, startCall, isLoading } =
  useInducedVoice();

// Start a call with custom configuration
await startCall({
  prompt: "You are a helpful assistant",
  language: "en-US",
  ttsModel: "eleven_multilingual_v2",
});

// Listen for incoming audio
on("audio.out", (audioData) => {
  // audioData is base64 encoded L16 PCM audio
  playAudio(audioData);
});

// Send audio data from microphone
const success = pipe(base64AudioData); // base64 encoded L16 PCM audio
if (!success) {
  console.error("Failed to send audio data");
}

// End the call when done
hangup();
```

#### Configuration Options

When starting a call, you can provide various options:

```typescript
interface CreateCallOptions {
  prompt?: string; // Initial prompt for the AI assistant
  sttProvider?: string; // Speech-to-text provider (default: "deepgram")
  ttsProvider?: string; // Text-to-speech provider (default: "elevenlabs")
  llmProvider?: string; // Language model provider (default: "openai")
  llmModel?: string; // Language model to use (default: "gpt-4")
  sttModel?: string; // Speech-to-text model (default: "nova-2")
  ttsModel?: string; // Text-to-speech model (default: "eleven_multilingual_v2")
  language?: string; // Language code (default: "en-US")
}
```

## Audio Format

The `pipe` function expects audio data in the following format:

- Base64 encoded
- L16 PCM audio
- 8000Hz sample rate
- Single channel (mono)

