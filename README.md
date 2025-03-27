# InducedAI Voice Platform

A comprehensive platform for building AI-powered voice applications, featuring both a robust backend voice processing engine and a WebSocket-based frontend demo.

## Overview

The platform consists of two main components:

1. **Backend Voice Agent** (`/src`): A framework for processing voice calls using BullMQ queues, workers, and multiple telephony providers
2. **Frontend Demo** (`/voice-fe`): A WebSocket-based demo application showcasing real-time voice communication with AI agents

## Features

### Backend Features

- Multiple telephony provider support:
  - Twilio integration for traditional phone calls
  - WebSocket provider for browser-based communication
- BullMQ queue system for reliable job processing
- Redis-backed persistence
- Modular architecture with provider abstraction
- Real-time audio streaming and processing
- Configurable AI service integrations:
  - Speech-to-Text (Deepgram)
  - Text-to-Speech (ElevenLabs)
  - Language Models (OpenAI)

### Frontend Features

- Real-time voice communication via WebSocket
- Call state management and duration tracking
- Event-based architecture
- Configurable AI providers and models
- TypeScript support with full type definitions
- Modern React hooks for easy integration

## Prerequisites

- Node.js (v18 or higher)
- Redis server
- Twilio account (optional, for phone call support)
- AI service provider accounts:
  - OpenAI API key
  - ElevenLabs API key
  - Deepgram API key

## Project Structure

```
/
├── src/                    # Backend voice agent
│   ├── config/            # Configuration management
│   ├── engine/            # Core voice processing engine
│   ├── lib/              # Shared utilities and helpers
│   ├── server/           # HTTP and WebSocket servers
│   ├── services/         # Service integrations
│   ├── types/            # TypeScript types and schemas
│   └── utils/            # Utility functions
│
└── voice-fe/             # Frontend WebSocket demo
    ├── src/
    │   ├── app/         # Next.js pages and components
    │   ├── hooks/       # React hooks including useInducedVoice
    │   └── components/  # Reusable UI components
    └── public/          # Static assets
```

## Getting Started

### Backend Setup

1. Install dependencies:

   ```bash
   cd src
   yarn install
   ```

2. Create a `.env` file in the root directory:

   ```
   # Redis Configuration
   REDIS_HOST=localhost
   REDIS_PORT=6379

   # Voice Agent Configuration
   VOICE_AGENT_CONCURRENCY=5

   # AI Service Providers
   OPENAI_API_KEY=your_openai_key
   ELEVENLABS_API_KEY=your_elevenlabs_key
   DEEPGRAM_API_KEY=your_deepgram_key

   # Optional Twilio Configuration
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   SERVER_URL=https://your-server-url.com
   ```

3. Start the backend:
   ```bash
   yarn dev
   ```

### Frontend Setup

1. Install dependencies:

   ```bash
   cd voice-fe
   npm install
   ```

2. Create a `.env.local` file:

   ```
   NEXT_PUBLIC_BACKEND_URL=http://localhost:3033
   NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:3033
   ```

3. Start the frontend:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

### Backend API

```typescript
import { TelephonyProvider } from "./providers/telephony";

// Initialize provider
const provider = TelephonyProvider.getInstance();
await provider.initialize();

// Create a voice call
const request = {
  fromNumber: "+15551234567",
  toNumber: "+15557654321",
  prompt: "You are a helpful AI assistant",
  provider: "twilio", // or "websocket"
};

const jobId = await provider.makeCall(request);
```

### Frontend Hook

```typescript
import { useInducedVoice } from "@/hooks/useInducedVoice";

function VoiceComponent() {
  const { callState, callDuration, hangup, pipe, on, startCall, isLoading } =
    useInducedVoice();

  // Start a call
  await startCall({
    prompt: "You are a helpful assistant",
    language: "en-US",
  });

  // Handle incoming audio
  on("audio.out", (audioData) => {
    // Process base64 encoded L16 PCM audio
    playAudio(audioData);
  });

  // Send audio data
  pipe(base64AudioData);
}
```

## Audio Format Specification

The platform expects audio in the following format:

- Encoding: Base64
- Format: L16 PCM
- Sample Rate: 8000Hz
- Channels: 1 (mono)

## Development

### Backend Development

```bash
cd src
yarn dev
```

### Frontend Development

```bash
cd voice-fe
npm run dev
```

## License

MIT
