# Voice AI WebSocket Demo

This is a demonstration of the WebSocket-based telephony provider for InducedAI's voice agent platform. Instead of making real phone calls, this provider enables voice communication directly through a WebSocket connection in a web browser.

## Features

- Real-time voice communication with an AI agent
- Audio recording and playback directly in the browser
- Transcript display of the conversation
- Simple UI for call control

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
   BACKEND_API_URL=http://localhost:3000
   ```

   Adjust the URL to match your backend server.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3001](http://localhost:3001) in your browser to see the application.

## How It Works

1. The frontend makes a request to the backend to create a new voice call session
2. The backend creates a call and returns a unique call ID
3. The frontend connects to the backend via a WebSocket using this call ID
4. Audio is streamed bidirectionally between the browser and the AI voice agent
5. The AI agent processes the audio, generates responses, and sends them back to the browser

## Usage

1. Click the "Create New Call" button to initiate a voice call session
2. Once the call is active, click "Start Speaking" to begin recording audio
3. Speak into your microphone to communicate with the AI agent
4. The AI agent will respond with audio played through your speakers
5. The transcript of the conversation will appear in real-time
6. Click "Stop Speaking" when you're done speaking
7. Click "Hang Up" to end the call

## Hook API

### useInducedCall

```tsx
const {
  callActive, // boolean - whether the call is currently active
  callDuration, // number - duration of the call in seconds
  transcript, // string[] - array of transcript segments
  hangup, // function - call to hang up
  pipe, // function(audioData: string) - send audio data to the AI
  events, // object with 'on' method to listen for events
} = useInducedCall(callId);
```

Events:

- 'audio.out' - Received when audio is sent from the AI
- 'call.started' - Received when the call is connected
- 'call.ended' - Received when the call ends

## License

MIT
