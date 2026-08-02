# AI Voice Agent Platform

> A simplified implementation of the production voice agent platform I built for customer support automation at my previous company.

**Demo:** https://www.loom.com/share/ff3a3fda8538445da8e1d3fa8411c09a

---

## Overview

This repository contains a simplified implementation of the voice agent platform I built and deployed in production.

It omits company-specific integrations, prompts, business logic, and deployment infrastructure while preserving the core architecture and engineering patterns.

The platform supports real-time conversational AI over both telephone (Twilio) and browser-based WebSockets, orchestrating speech recognition, language models, text-to-speech, and tool execution through a queue-based architecture.

---

## What have I built
- Designed the overall voice agent architecture.
- Built the backend orchestration engine.
- Implemented Twilio, Sarvam, and WebSocket providers for phone and browser-based voice calls.
- Integrated OpenAI, Deepgram, and ElevenLabs.
- Built the frontend demo for browser-based voice conversations.
- Designed the queue-based processing pipeline using BullMQ and Redis.

---

## Features

### Backend

- Twilio telephony integration
- Browser/WebSocket telephony
- BullMQ worker architecture
- Redis-backed job processing
- Streaming Speech-to-Text (Deepgram)
- Streaming Text-to-Speech (ElevenLabs)
- OpenAI LLM integration
- Modular provider abstraction
- Real-time audio streaming
- Configurable AI providers

### Frontend

- Real-time browser voice conversations
- WebSocket communication
- Call state management
- Event-driven architecture
- React hooks
- Full TypeScript support

---

## Architecture

```text
                Twilio / Browser
                       │
                       ▼
            Telephony Provider Layer
                       │
                       ▼
                BullMQ Queue
                       │
                Voice Workers
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Deepgram        OpenAI        ElevenLabs
      STT            LLM             TTS
                       │
                       ▼
                Audio Response
```

---

## Demo

A walkthrough of the platform is available here:

https://www.loom.com/share/ff3a3fda8538445da8e1d3fa8411c09a

---

## Tech Stack

- TypeScript
- Node.js
- BullMQ
- Redis
- Twilio
- WebSockets
- OpenAI
- Deepgram
- ElevenLabs
- Next.js
- React

---

## Repository Structure

```text
/
├── src/
│   ├── config/
│   ├── engine/
│   ├── lib/
│   ├── server/
│   ├── services/
│   ├── types/
│   └── utils/
│
└── voice-fe/
    ├── app/
    ├── hooks/
    ├── components/
    └── public/
```

---

## Running Locally

See the setup instructions below for installing dependencies, configuring environment variables, and running both the backend and frontend locally.

## Overview

The platform consists of two main components:

1. **Backend Voice Agent** (`/src`): A framework for processing voice calls using BullMQ queues, workers, and multiple telephony providers
2. **Frontend Demo** (`/voice-fe`): A WebSocket-based demo application showcasing real-time voice communication with AI agents

## Prerequisites

- Node.js (v18 or higher)
- Redis server
- Twilio account (optional, for phone call support)
- AI service provider accounts:
  - OpenAI API key
  - ElevenLabs API key
  - Deepgram API key
  
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
