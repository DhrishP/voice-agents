# Voice Agent

A framework for processing voice calls using BullMQ queues, workers, and Twilio integration.

## Features

- BullMQ queue for processing voice call requests
- Worker for handling voice call jobs
- Zod schema validation for request data
- Redis-backed job queue for reliability and persistence
- Unified Twilio service for seamless call management
- WebSocket support for real-time audio streaming

## Prerequisites

- Node.js (v16 or higher)
- Redis server
- Twilio account with API credentials

## Installation

```bash
# Install dependencies
yarn install

# Build the project
yarn build
```

## Configuration

Create a `.env` file in the root directory with the following variables:

```
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=

# Voice Agent Configuration
VOICE_AGENT_CONCURRENCY=5

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
SERVER_URL=https://your-server-url.com
TWILIO_SERVER_PORT=3000
```

## Usage

### Starting the Voice Agent

```bash
# Start the voice agent
yarn start
```

### Development Mode

```bash
# Run in development mode with hot reloading
yarn dev
```

### API

The Voice Agent provides a simple API for creating and managing voice calls:

```typescript
import { TelephonyProvider } from "./providers/telephony";
import { VoiceCallRequest } from "./types/voice-call";

// Get telephony provider instance
const telephonyProvider = TelephonyProvider.getInstance();
await telephonyProvider.initialize();

// Create a voice call
const request: VoiceCallRequest = {
  fromNumber: "+15551234567",
  toNumber: "+15557654321",
  prompt: "Hello, this is a test voice call from our automated system.",
  provider: "twilio",
  outputSchema: {
    callStatus: "string",
    callDuration: "number",
    userResponse: "string",
  },
};

// Make the call
const jobId = await telephonyProvider.makeCall(request);
console.log(`Voice call job created with ID: ${jobId}`);

// Get the call ID from the job ID
const callId = await telephonyProvider.getCallIdFromJobId(jobId);

// Send a message to the call
await telephonyProvider.send(callId, "How can I help you today?");

// Listen for speech from the call
telephonyProvider.onListen(callId, (speechChunk) => {
  console.log(`Received speech: ${speechChunk}`);
});

// Hang up the call when done
await telephonyProvider.hangup(callId);

// Shutdown the telephony provider when done
await telephonyProvider.shutdown();
```

## Twilio Service

The Voice Agent includes a unified Twilio service that provides a clean interface for managing calls:

```typescript
import twilioService from "./services/twillio/twilio-service";

// Make a call
const { callId, callSid } = await twilioService.makeCall(
  "+15551234567",
  "+15557654321",
  "Hello, this is a test call"
);

// Send audio to a call
await twilioService.sendAudio(callId, "How are you today?");

// Listen for speech from the call
twilioService.registerListener(callId, (text) => {
  console.log(`User said: ${text}`);
});

// Get call status
const status = twilioService.getCallStatus(callId);

// Hang up a call
await twilioService.hangupCall(callId);
```

## Project Structure

- `src/providers`: Contains the TelephonyProvider class
- `src/services/twillio`: Contains the unified Twilio service
- `src/services/queue`: Contains the BullMQ queue and worker implementations
- `src/services/server`: Contains the Express server for Twilio webhooks
- `src/types`: Contains TypeScript types and Zod schemas
- `src/index.ts`: Main entry point

## License

MIT
