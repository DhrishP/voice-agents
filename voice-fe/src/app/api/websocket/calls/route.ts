import { NextRequest, NextResponse } from "next/server";

// Get the backend API URL from environment variable or use a default
const API_URL = process.env.BACKEND_API_URL || "http://localhost:3000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    if (!body.prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    // Forward the request to the backend API
    const response = await fetch("http://localhost:3033/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: body.prompt,
        sttProvider: body.sttProvider || "deepgram",
        ttsProvider: body.ttsProvider || "elevenlabs",
        llmProvider: body.llmProvider || "openai",
        llmModel: body.llmModel || "gpt-4o",
        sttModel: body.sttModel || "nova-2",
        ttsModel: body.ttsModel || "eleven_multilingual_v2",
        language: body.language || "en-US",
      }),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error occurred" }));
      return NextResponse.json(
        { error: errorData.error || "Failed to create call" },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      callId: data.callId,
      wsUrl: `${
        process.env.NEXT_PUBLIC_BACKEND_WS_URL || "ws://localhost:3033"
      }/stream/${data.callId}`,
    });
  } catch (error) {
    console.error("Error creating WebSocket call:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
