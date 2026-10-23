import { getProviderConnectionById } from "@/lib/localDb";
import { clearQuotaHistory, getQuotaHistory } from "@/lib/db";

// GET /api/usage/[connectionId]/history?hours=24&limit=240
// Cross-device quota samples recorded by the usage route (one row per quota/minute).
export async function GET(request, { params }) {
  try {
    const { connectionId } = await params;
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const hours = Math.max(1, Math.min(168, Number(url.searchParams.get("hours")) || 24));
    const limit = Math.max(2, Math.min(500, Number(url.searchParams.get("limit")) || 240));
    const series = await getQuotaHistory(connectionId, { hours, limit });
    const sampleCount = Object.values(series).reduce((sum, rows) => sum + rows.length, 0);

    return Response.json({
      connectionId,
      hours,
      limit,
      sampleCount,
      updatedAt: Date.now(),
      series,
    });
  } catch (error) {
    console.error("[Quota History API]", error);
    return Response.json({ error: error.message || "Failed to load quota history" }, { status: 500 });
  }
}

// DELETE /api/usage/[connectionId]/history — purge this connection's history.
export async function DELETE(request, { params }) {
  try {
    const { connectionId } = await params;
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }
    const deleted = await clearQuotaHistory(connectionId);
    return Response.json({ ok: true, connectionId, deleted });
  } catch (error) {
    console.error("[Quota History API] purge", error);
    return Response.json({ error: error.message || "Failed to purge quota history" }, { status: 500 });
  }
}
