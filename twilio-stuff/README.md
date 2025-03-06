# Twilio Voice Agent

A TypeScript Express application for handling Twilio voice calls with bidirectional streams.

## Features

- Initiate phone calls via Twilio
- Handle bidirectional audio streams
- WebSocket-based real-time communication
- TwiML generation for call control

## Setup

1. Set up environment variables:

   ```bash
   export TWILIO_ACCOUNT_SID=your_account_sid
   export TWILIO_AUTH_TOKEN=your_auth_token
   ```

   Or create a `.env` file:

   ```
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the TypeScript code:

   ```bash
   npm run build
   ```

4. Start the server:

   ```bash
   npm start
   ```

   For development with hot-reload:

   ```bash
   npm run dev
   ```

## API Endpoints

### POST /call

Initiates a new call.

Request body:

```json
{
  "baseApiUrl": "https://your-ngrok-url.ngrok.io",
  "fromNumber": "+1234567890",
  "toNumber": "+1987654321"
}
```

Response:

```json
{
  "callId": "uuid-of-the-call"
}
```

Error Response:

```json
{
  "error": "baseApiUrl, fromNumber, and toNumber are required",
  "missing": ["fromNumber", "toNumber"]
}
```

### GET /twiml/:callId

Returns TwiML for Twilio to establish the WebSocket connection.

### POST /hangup/:callId

Terminates an active call.

## WebSocket Connection

The WebSocket endpoint is available at:

```
ws://your-server:3000/stream/:callId
```

## Development

- `npm run build`: Compiles TypeScript to JavaScript
- `npm start`: Starts the production server
- `npm run dev`: Starts the development server with hot-reload
- `npm run watch`: Watches for TypeScript changes and recompiles

## Testing with curl

1. Start a new call:

```bash
curl -X POST \
  http://localhost:3000/call \
  -H 'Content-Type: application/json' \
  -d '{
    "baseApiUrl": "https://your-ngrok-url.ngrok.io",
    "fromNumber": "+1234567890",
    "toNumber": "+1987654321"
  }'
```

2. Get TwiML for a call:

```bash
curl http://localhost:3000/twiml/<callId>
```

3. Hang up a call:

```bash
curl -X POST http://localhost:3000/hangup/<callId>
```

Note: Replace `your-ngrok-url.ngrok.io` with your actual ngrok URL, and use valid phone numbers in the E.164 format (e.g., +1234567890).
