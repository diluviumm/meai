import { beforeEach, describe, expect, it, vi } from "vitest";

describe("xai/oauth service", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    // Default response → panggilan latar tak pernah menerima undefined
    // (akar "Cannot read properties of undefined (reading 'ok')").
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }),
    );
  });

  it("validates discovered endpoints are https x.ai URLs", async () => {
    const { validateOAuthEndpoint } = await import("../../src/lib/oauth/services/xai.js");

    expect(validateOAuthEndpoint("https://auth.x.ai/oauth2/authorize", "authorization_endpoint")).toBe(
      "https://auth.x.ai/oauth2/authorize"
    );
    expect(() => validateOAuthEndpoint("http://auth.x.ai/oauth2/authorize", "authorization_endpoint")).toThrow(
      /must use https/
    );
    expect(() => validateOAuthEndpoint("https://example.com/oauth2/authorize", "authorization_endpoint")).toThrow(
      /is not on x\.ai/
    );
  });

  it("discovers endpoints without custom user-agent headers", async () => {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes("openid-configuration")) {
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
            token_endpoint: "https://auth.x.ai/oauth2/token",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { discoverEndpoints } = await import("../../src/lib/oauth/services/xai.js");
    await expect(discoverEndpoints()).resolves.toEqual({
      authorizeUrl: "https://auth.x.ai/oauth2/authorize",
      tokenUrl: "https://auth.x.ai/oauth2/token",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://auth.x.ai/.well-known/openid-configuration",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("builds authorize URLs with CLIProxyAPI query extras", async () => {
    const { XaiService } = await import("../../src/lib/oauth/services/xai.js");
    const authUrl = new XaiService().buildXaiAuthUrl(
      "http://127.0.0.1:56121/callback",
      "state-1",
      "challenge-1",
      "https://auth.x.ai/oauth2/authorize"
    );
    const parsed = new URL(authUrl);

    expect(parsed.origin + parsed.pathname).toBe("https://auth.x.ai/oauth2/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state-1");
    expect(parsed.searchParams.get("nonce")).toMatch(/^[a-f0-9]{32}$/);
    expect(parsed.searchParams.get("plan")).toBe("generic");
    expect(parsed.searchParams.get("referrer")).toBe("cli-proxy-api");
  });

  it("generates dashboard auth data with CLIProxyAPI PKCE size and discovered endpoints", async () => {
    fetch.mockImplementation(async (url) => {
      if (String(url).includes("openid-configuration")) {
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: "https://auth.x.ai/oauth2/authorize-from-discovery",
            token_endpoint: "https://auth.x.ai/oauth2/token-from-discovery",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { generateAuthData } = await import("../../src/lib/oauth/providers.js");
    const data = await generateAuthData("xai", "http://127.0.0.1:56121/callback");
    const parsed = new URL(data.authUrl);

    expect(data.codeVerifier).toHaveLength(128);
    expect(parsed.origin + parsed.pathname).toBe("https://auth.x.ai/oauth2/authorize-from-discovery");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("plan")).toBe("generic");
    expect(parsed.searchParams.get("referrer")).toBe("cli-proxy-api");
  });

  it("exchanges dashboard codes against the discovered xAI token endpoint", async () => {
    const fetchMock = fetch;
    // Router by URL: tahan terhadap discovery terpanggil berapa pun kali
    // (urutan mock sekali-pakai = akar flaky saat suite penuh).
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("openid-configuration")) {
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
            token_endpoint: "https://auth.x.ai/oauth2/token-from-discovery",
          }),
        };
      }
      if (u.includes("/oauth2/token")) {
        return {
          ok: true,
          json: async () => ({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");
    const tokens = await exchangeTokens(
      "xai",
      "auth-code",
      "http://127.0.0.1:56121/callback",
      "verifier-1",
      "state-1"
    );

    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/oauth2/token"));
    expect(tokenCall, "token endpoint harus dipanggil").toBeTruthy();
    expect(tokenCall[0]).toBe("https://auth.x.ai/oauth2/token-from-discovery");
    expect(tokenCall[1].body.get("grant_type")).toBe("authorization_code");
    expect(tokenCall[1].body.get("code")).toBe("auth-code");
    expect(tokenCall[1].body.get("code_verifier")).toBe("verifier-1");
    expect(tokens).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
  });
});
