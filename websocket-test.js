const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const FormData = require("form-data");

// Configuration
const SERVER_URL = "http://localhost:3033"; // REST API endpoint for WebSocket server
const RECORDING_DIR = path.join(__dirname, "test-recordings");

// WAV header constants for 8kHz µ-law audio
const WAV_HEADER_SIZE = 44;
const MULAW_FORMAT = 7; // PCM_FORMAT = 1, MULAW = 7

function createWavHeader(dataLength) {
  const buffer = Buffer.alloc(WAV_HEADER_SIZE);

  // RIFF chunk descriptor
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(dataLength + 36, 4); // File size - 8
  buffer.write("WAVE", 8);

  // fmt sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(MULAW_FORMAT, 20); // AudioFormat (7 for µ-law)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 for mono)
  buffer.writeUInt32LE(8000, 24); // SampleRate (8000 Hz)
  buffer.writeUInt32LE(8000, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(1, 32); // BlockAlign (NumChannels * BitsPerSample/8)
  buffer.writeUInt16LE(8, 34); // BitsPerSample (8 bits)

  // data sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}

// Create recordings directory if it doesn't exist
if (!fs.existsSync(RECORDING_DIR)) {
  fs.mkdirSync(RECORDING_DIR, { recursive: true });
}

// Keep track of active connections
let activeConnection = null;
let callId = null;

// Setup process termination handler
process.on("SIGINT", () => {
  console.log("Closing WebSocket connection and exiting...");
  if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
    activeConnection.close();
  }
  process.exit(0);
});

// Create a new session and connect to it
async function createSession() {
  try {
    // Create a session with a custom prompt
    const response = await fetch(`${SERVER_URL}/configure-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt:
          "You are a helpful assistant. Please respond concisely and clearly. If asked a question, provide a useful answer.",
        llmProvider: "openai",
        llmModel: "gpt-4o",
        ttsProvider: "elevenlabs",
        ttsModel: "eleven_multilingual_v2",
      }),
    });

    const data = await response.json();
    console.log("Session created with configuration:", data);
    callId = data.callId;

    // Connect to WebSocket
    connectToWebSocket(data.wsUrl, data.callId);

    return data.callId;
  } catch (error) {
    console.error("Error creating session:", error);
  }
}

// Connect to WebSocket
function connectToWebSocket(wsUrl, callId) {
  console.log(`Connecting to WebSocket at ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  // Store the active connection
  activeConnection = ws;

  // Send a keepalive ping every 30 seconds to maintain the connection
  const keepAlivePing = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: "ping" }));
      console.log("Sending keepalive ping...");
    } else {
      clearInterval(keepAlivePing);
    }
  }, 30000);

  ws.on("open", () => {
    console.log("WebSocket connection established");

    // Send a call.started event
    ws.send(
      JSON.stringify({
        event: "call.started",
      })
    );

    console.log("Waiting 3 seconds before sending a test message...");

    // Send a test text message after connection is established
    setTimeout(() => {
      const testMessage = "Hello, can you tell me about yourself?";
      console.log(`Sending test message: "${testMessage}"`);

      ws.send(
        JSON.stringify({
          event: "text",
          data: testMessage,
        })
      );
    }, 3000);
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`Received message event: ${message.event}`);

      if (message.event === "audio.out") {
        // Convert base64 to buffer
        const audioData = Buffer.from(message.data, "base64");

        // Create WAV file with proper header
        const wavHeader = createWavHeader(audioData.length);
        const wavFile = Buffer.concat([wavHeader, audioData]);

        // Save as WAV file
        const fileName = `${callId}-${Date.now()}.wav`;
        const filePath = path.join(RECORDING_DIR, fileName);

        fs.writeFileSync(filePath, wavFile);
        console.log(`✅ Saved audio to ${filePath}`);

        // Send acknowledgment back to server
        ws.send(
          JSON.stringify({
            event: "audio.received",
            timestamp: Date.now(),
          })
        );
      } else if (message.event === "call.connected") {
        console.log(`WebSocket connection confirmed: ${message.message}`);
      } else if (message.event === "error") {
        console.error(`Error from server: ${message.message}`);
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    activeConnection = null;

    // Try to reconnect
    setTimeout(() => {
      if (!activeConnection) {
        console.log("Attempting to reconnect...");
        connectToWebSocket(wsUrl, callId);
      }
    }, 5000);
  });

  ws.on("close", () => {
    console.log("WebSocket connection closed");
    activeConnection = null;
    clearInterval(keepAlivePing);

    // Try to reconnect
    setTimeout(() => {
      if (!activeConnection) {
        console.log("Attempting to reconnect...");
        connectToWebSocket(wsUrl, callId);
      }
    }, 5000);
  });

  // Allow sending manual messages for testing
  process.stdin.on("data", (data) => {
    const input = data.toString().trim();

    if (input === "quit") {
      clearInterval(keepAlivePing);
      ws.close();
      process.exit(0);
    } else if (input === "audio") {
      uploadTestAudio(callId);
    } else if (input === "restart") {
      clearInterval(keepAlivePing);
      ws.close();
      createSession();
    } else {
      console.log(`Sending message: "${input}"`);
      ws.send(
        JSON.stringify({
          event: "text",
          data: input,
        })
      );
    }
  });
}

// Upload test audio file
async function uploadTestAudio(callId) {
  try {
    const testAudioPath = path.join(__dirname, "test-audio.wav");

    // Check if file exists
    if (!fs.existsSync(testAudioPath)) {
      console.error(`Test audio file not found at ${testAudioPath}`);
      return;
    }

    const formData = new FormData();
    formData.append("audio", fs.createReadStream(testAudioPath));
    formData.append("callId", callId);

    const response = await fetch(`${SERVER_URL}/upload-test-audio`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    console.log("Upload response:", data);
  } catch (error) {
    console.error("Error uploading test audio:", error);
  }
}

// Start the process
console.log("Creating a new WebSocket session...");
createSession();
console.log("Type a message to send as text input");
console.log('Type "audio" to send test audio');
console.log('Type "restart" to create a new session');
console.log('Type "quit" to exit');
