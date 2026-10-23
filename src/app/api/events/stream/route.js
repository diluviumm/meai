import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/stream — lightweight server-sent ticker for the dashboard.
 * It deliberately sends a compact heartbeat rather than full usage payloads:
 * the client keeps its normal /api/insights fetch and uses this stream to show
 * a live connection state without polling every second.
 */
export async function GET(request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (payload) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      send({ type: "hello", ts: Date.now(), version: "0.5.109" });
      const timer = setInterval(() => send({ type: "tick", ts: Date.now() }), 15_000);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", close);
    },
  });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
