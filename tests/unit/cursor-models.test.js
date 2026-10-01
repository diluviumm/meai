import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

const originalFetch = global.fetch;

// ── Ronde-45: transport kini HTTP/2 (http2PostProto) — mock node:http2 ──────
// agent.api5.cursor.sh hanya melayani HTTP/2 ("Node fetch/undici cannot speak
// h2"), jadi global.fetch tak pernah dipanggil lagi — mock node:http2 penuh
// supaya test deterministic tanpa jaringan.
const h2 = vi.hoisted(() => ({
  fail: false,           // true → balas 403 (ujian fails-open)
  calls: 0,
  lastHeaders: null,
  responsePayload: null, // Uint8Array protos utk disebalas
}));

// Factory menghasilkan API http2 mock; default & named connect menunjuk API
// yang sama (kode memakai `import http2 from "http2"` → default export wajib).
const http2Factory = vi.hoisted(() => {
  const api = {
    connect: () => ({
      on: () => {},
      close: () => {},
      request: (headers) => {
        h2.calls += 1;
        h2.lastHeaders = headers;
        const handlers = {};
        const req = {
          on: (ev, fn) => {
            handlers[ev] = fn;
            return req;
          },
          end: () => {
            queueMicrotask(() => {
              handlers.response?.({ ":status": h2.fail ? 403 : 200 });
              if (!h2.fail && h2.responsePayload) handlers.data?.(h2.responsePayload);
              handlers.end?.();
            });
          },
        };
        return req;
      },
    }),
  };
  return () => ({ ...api, default: api });
});
// cursorModels.js mengimpor "http2" TANPA prefix node: — mock harus pada key
// import yang sama agar menangkapnya (dua nama = satu modul di Node, tapi
// registry mock vitest per-spek-string).
vi.mock("http2", http2Factory);
vi.mock("node:http2", http2Factory);

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    h2.fail = false;
    h2.calls = 0;
    h2.lastHeaders = null;
    h2.responsePayload = null;
    clearCursorModelCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    h2.responsePayload = payload; // dibalas lewat kanal http2 (bukan fetch)
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    // Kontrak transport BARU: POST unary via HTTP/2 dengan body protos
    // unframed (bukan global.fetch lagi — lihat http2PostProto di cursorModels.js)
    expect(h2.calls).toBe(1);
    expect(h2.lastHeaders).toMatchObject({
      ":method": "POST",
      ":path": "/agent.v1.AgentService/GetUsableModels",
      ":authority": "agent.api5.cursor.sh",
      "content-type": "application/proto",
      accept: "application/proto",
    });
  });

  it("fails open when the Cursor catalog request fails", async () => {
    h2.fail = true; // 403 via kanal http2

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });
});
