import { NextRequest } from "next/server";

const BACKEND_WS_URL = process.env.BACKEND_WS_URL || "ws://localhost:3033";

export async function GET(
  request: NextRequest,
  { params }: { params: { callId: string } }
) {
  if (!request.headers.get("upgrade")?.includes("websocket")) {
    return new Response("Expected Websocket", { status: 400 });
  }

  try {
    const wsUrl = `${BACKEND_WS_URL}/stream/${params.callId}`;
    const res = await fetch(wsUrl, {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
      },
    });

    return new Response(null, {
      status: 101,
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Accept": res.headers.get("Sec-WebSocket-Accept") || "",
      },
    });
  } catch (err) {
    console.error("WebSocket connection failed:", err);
    return new Response("WebSocket connection failed", { status: 500 });
  }
}
