// Regression guard for the CodeBuddy Intl channel-verification header family.
//
// Since 2026-10-16 www.codebuddy.ai rejects /v2/chat/completions with
// 400/11128 "request illegal" unless the request carries the same
// X-Conversation-* identity headers as the official client. The executor must
// send them for both API-key and OAuth credentials, and API-key mode must also
// carry X-API-Key/X-User-Id:anonymous (the CLI shape).
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { CodeBuddyIntlExecutor } from "open-sse/executors/codebuddy-intl.js";

const executor = new CodeBuddyIntlExecutor();
const body = {
  messages: [
    { role: "system", content: "You are CodeBuddy Code." },
    { role: "user", content: "Say OK" },
  ],
};
const url = "https://www.codebuddy.ai/v2/chat/completions";
const model = "deepseek-v4.1-flash";

describe("CodeBuddy Intl official-client headers", () => {
  it("sends a stable X-Conversation-ID derived from the first user message", () => {
    const headers = executor.buildHeaders({ apiKey: "ck_test" }, true, url, model, body);
    const expected = crypto
      .createHash("sha256")
      .update("Say OK")
      .digest("hex")
      .slice(0, 32);
    expect(headers["X-Conversation-ID"]).toBe(expected);
    expect(headers["X-Conversation-Message-ID"]).toMatch(/^[a-f0-9]{32}$/);
    expect(headers["X-Conversation-Request-ID"]).toMatch(/^[a-f0-9]{32}$/);
    expect(headers["X-Request-ID"]).toMatch(/^[a-f0-9]{32}$/);
  });

  it("adds the API-key CLI identity without touching OAuth credentials", () => {
    const apiKeyHeaders = executor.buildHeaders({ apiKey: "ck_test" }, true, url, model, body);
    expect(apiKeyHeaders["X-API-Key"]).toBe("ck_test");
    expect(apiKeyHeaders["X-User-Id"]).toBe("anonymous");
    expect(apiKeyHeaders["X-Agent-Intent"]).toBe("craft");
    expect(apiKeyHeaders["X-Domain"]).toBe("www.codebuddy.ai");

    const oauthHeaders = executor.buildHeaders({ accessToken: "oauth-token" }, true, url, model, body);
    expect(oauthHeaders["X-API-Key"]).toBeUndefined();
    expect(oauthHeaders["X-User-Id"]).toBeUndefined();
    expect(oauthHeaders["Authorization"]).toContain("oauth-token");
  });

  it("maps 11140 to an account-restriction message, not an OAuth instruction", () => {
    const parsed = executor.parseError(
      { status: 403 },
      JSON.stringify({ code: 11140, msg: "account restricted" }),
    );
    expect(parsed.status).toBe(403);
    expect(parsed.message).toContain("11140");
    expect(parsed.message.toLowerCase()).toContain("dibatasi");
    expect(parsed.message.toLowerCase()).not.toContain("connect with oauth");
  });

  it("maps 11128 to a header/proxy hint and keeps the API key valid for quota", () => {
    const parsed = executor.parseError(
      { status: 400 },
      JSON.stringify({ code: 11128, msg: "request illegal" }),
    );
    expect(parsed.status).toBe(400);
    expect(parsed.message).toContain("11128");
    expect(parsed.message).toContain("X-Conversation");
    expect(parsed.message.toLowerCase()).not.toContain("connect with oauth");
  });
});
