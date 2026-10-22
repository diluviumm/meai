import crypto from "node:crypto";
import { DefaultExecutor } from "./default.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }

  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);

    // Intl (www.codebuddy.ai) enforces a "conversation identity" gate on
    // /v2/chat/completions since 2026-10-16: missing X-Conversation-* headers
    // return 400/11128 "request illegal" before the body is even inspected.
    // X-Conversation-ID must stay stable for a conversation (upstream uses it
    // for prompt-prefix cache bucketing), so derive it from the first user
    // message. The first message in the transformed body is the synthetic
    // system prompt — using it would give every conversation the same id.
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const firstUser = messages.find((message) => message?.role === "user");
    const firstContent =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? firstUser.content
              .map((part) => (typeof part === "string" ? part : part?.text || ""))
              .join("\n")
          : "";
    const seed = firstContent || JSON.stringify(body ?? {});
    headers["X-Conversation-ID"] = crypto
      .createHash("sha256")
      .update(seed)
      .digest("hex")
      .slice(0, 32);
    headers["X-Conversation-Message-ID"] = crypto.randomUUID().replace(/-/g, "");
    headers["X-Conversation-Request-ID"] = crypto.randomUUID().replace(/-/g, "");
    headers["X-Request-ID"] = crypto.randomUUID().replace(/-/g, "");

    // API-key mode mirrors the official CLI: X-API-Key + an anonymous user id.
    // OAuth credentials already carry a real X-User-Id downstream and must not
    // be overwritten with "anonymous".
    if (credentials?.apiKey && !credentials?.accessToken) {
      headers["X-API-Key"] = credentials.apiKey;
      headers["X-User-Id"] = headers["X-User-Id"] || "anonymous";
      headers["X-Agent-Intent"] = "craft";
      headers["X-Domain"] = "www.codebuddy.ai";
    }

    return headers;
  }

  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        // 11128 on the intl gateway is a channel-verification rejection: the
        // request looks like it did not come from an official client. The
        // executor now sends the full official-client header family
        // (X-Conversation-*, X-API-Key, X-User-Id); if it still appears, a
        // proxy or caller is stripping those headers.
        if (data?.code === 11128) {
          return {
            status: 400,
            message:
              "CodeBuddy Intl menolak chat dengan 400/11128 (channel verification). " +
              "Build ini sudah mengirim header official-client; jika masih muncul, periksa proxy yang " +
              "membuang header X-Conversation-*/X-API-Key. API key tetap valid untuk membaca quota.",
          };
        }
        // 11140 = account-level risk control ("unusual activity"). It is not a
        // header problem and not an OAuth-vs-API-key problem: the key can still
        // read quota, but chat is blocked until the provider lifts the review.
        if (data?.code === 11140) {
          return {
            status: 403,
            message:
              "Akun CodeBuddy Intl sedang dibatasi provider (11140 unusual activity). " +
              "Ini pembatasan akun, bukan masalah OAuth atau format API key. " +
              "Quota tetap terbaca; chat pulih setelah pembatasan provider berakhir atau lewat appeal " +
              "di official client. Gunakan provider CodeBuddy CN untuk model yang sama selama masa pembatasan.",
          };
        }
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
