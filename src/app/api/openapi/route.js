import { NextResponse } from "next/server";

export const dynamic = "force-static";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "MeAI API",
    version: "0.5.109",
    description: "OpenAI-compatible gateway plus MeAI dashboard/ops endpoints.",
  },
  servers: [{ url: "http://127.0.0.1:20128", description: "Local MeAI" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      cookieAuth: { type: "apiKey", in: "cookie", name: "auth_token" },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/api/healthz": { get: { summary: "Liveness and version", responses: { 200: { description: "OK" } } } },
    "/v1/models": { get: { summary: "List available models", responses: { 200: { description: "Model list" } } } },
    "/v1/chat/completions": { post: { summary: "OpenAI-compatible chat completion", responses: { 200: { description: "Completion or SSE stream" } } } },
    "/v1/messages": { post: { summary: "Anthropic-compatible messages", responses: { 200: { description: "Message response" } } } },
    "/api/usage/{connectionId}/history": {
      get: {
        summary: "Quota history for a connection",
        parameters: [
          { name: "connectionId", in: "path", required: true, schema: { type: "string" } },
          { name: "hours", in: "query", schema: { type: "integer", minimum: 1, maximum: 168, default: 24 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 2, maximum: 500, default: 240 } },
        ],
        responses: { 200: { description: "Series per quota" }, 404: { description: "Connection not found" } },
      },
      delete: { summary: "Purge quota history for a connection", responses: { 200: { description: "Purged" }, 404: { description: "Connection not found" } } },
    },
    "/api/insights": {
      get: {
        summary: "Health score, leaderboard, anomaly, cache, heatmap",
        parameters: [{ name: "hours", in: "query", schema: { type: "integer", minimum: 1, maximum: 168, default: 24 } }],
        responses: { 200: { description: "Insight payload" } },
      },
    },
    "/api/upstream": { get: { summary: "Fork upstream status", responses: { 200: { description: "Behind/commits/dirty" } } } },
    "/api/combos": { get: { summary: "List combos", responses: { 200: { description: "Combos" } } } },
  },
};

export async function GET() {
  return NextResponse.json(spec, { headers: { "Cache-Control": "public, max-age=300" } });
}
