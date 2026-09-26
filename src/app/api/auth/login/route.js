import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { isLocalRequest } from "@/dashboardGuard";
import { recordLoginEvent } from "@/lib/auth/auditLog";

const RESET_HINT = "Forgot password? Reset to default via MeAI CLI → Settings → Reset Password to Default.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const password = body?.password;
    if (typeof password !== "string" || password.length === 0) {
      return NextResponse.json({ error: "Password required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    // ---- Anti-bot (ronde-31): honeypot + timing + Turnstile opsional ----
    // Cron (meai-daily/usage/availability/visual-guard) tidak mengirim field ini → lolos.
    const { website, ts, turnstileToken } = body || {};
    if (typeof website === "string" && website.trim() !== "") {
      // len dicatat utk diagnosis (bukan nilainya) — isi panjang khas URL/username
      recordLoginEvent({ ip, ok: false, method: "bot", detail: `honeypot(len=${website.trim().length})` });
      return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (typeof ts === "number" && Date.now() - ts < 1200) {
      recordLoginEvent({ ip, ok: false, method: "bot", detail: "too-fast" });
      return NextResponse.json({ error: "Please try again in a moment" }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const turnstileSecret = process.env.CF_TURNSTILE_SECRET;
    // Ronde-37 (pasang kunci riil): akses lokal-langsung (cron/suite loopback,
    // tanpa stempel proxy & Origin loopback) lolos token — automation tak pernah
    // mengirim token. Via tunnel/proxy (stempel x-9r-via-proxy) atau Origin asing
    // = isLocalRequest false → mode ketat di bawah berlaku penuh (wajib token
    // + siteverify sukses). isLocalRequest anti-spoof: peer socket harus loopback.
    const turnstileLocal = isLocalRequest(request);
    if (turnstileSecret && !turnstileLocal) {
      // Official Cloudflare TEST secret (always-pass) = mode uji: token yg ada
      // tetap diverifikasi via API (bukti jalur), tapi TIDAK PERNAH mengunci
      // login bila token kosong / CF tak terjangkau (widget gagal muat).
      // Ganti ke secret asli → mode ketat (wajib token + verify sukses).
      const isTest = turnstileSecret.startsWith("1x0000000000000000000000000000000");
      const hasToken = typeof turnstileToken === "string" && turnstileToken.length > 0;
      if (hasToken) {
        try {
          const form = new FormData();
          form.append("secret", turnstileSecret);
          form.append("response", turnstileToken);
          const vr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
          const vj = await vr.json();
          if (!vj.success && !isTest) {
            recordLoginEvent({ ip, ok: false, method: "turnstile", detail: "verify-failed" });
            return NextResponse.json({ error: "Security verification failed" }, { status: 403, headers: NO_STORE_HEADERS });
          }
        } catch {
          if (!isTest) {
            return NextResponse.json({ error: "Security verification unavailable" }, { status: 502, headers: NO_STORE_HEADERS });
          }
        }
      } else if (!isTest) {
        return NextResponse.json({ error: "Security verification required" }, { status: 403, headers: NO_STORE_HEADERS });
      }
    }
    // ---- /Anti-bot ----

    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    // Default password is '123456' if not set
    const storedHash = settings.password;

    if (settings.authMode === "sso" || settings.authMode === "saml" || settings.authMode === "oidc") {
      const ssoType = settings.ssoType || (settings.authMode === "saml" ? "saml" : "oidc");
      if (ssoType === "saml" && isSamlConfigured(settings)) {
        return NextResponse.json({ error: "Password login is disabled. Use SAML SSO sign in." }, { status: 403 });
      }
      if (ssoType === "oidc" && isOidcConfigured(settings)) {
        return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
      }
    }

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // Use env var or default
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      isValid = password === initialPassword;
    }

    if (isValid) {
      recordSuccess(ip);

      // Default password still in use on a remote client → force a password
      // change before the dashboard is exposed remotely (keeps local UX intact).
      const mustChangePassword =
        !storedHash && !process.env.INITIAL_PASSWORD && !isLocalRequest(request);

      if (mustChangePassword) {
        // Do NOT issue a session token: a fresh install's default password is
        // public knowledge ("123456"), so handing out a valid JWT would let any
        // remote attacker authenticate and (e.g.) PATCH /api/settings to disable
        // authentication entirely (CVE-2026-56679 class). Require the password
        // to be changed first.
        //
        // NOTE: this intentionally leaves no remote self-service password-change
        // path — the change-password flow (PATCH /api/settings) requires a JWT,
        // which we deliberately withhold. A remote fresh-install user must either
        // change the password from the local machine or set INITIAL_PASSWORD
        // before first launch. This is a deliberate security trade-off, not an
        // oversight: issuing any credential before the default password is
        // rotated re-opens the exact attack chain this branch closes.
        return NextResponse.json(
          { success: false, error: "Default password must be changed before remote access. Change it from the local machine (or set INITIAL_PASSWORD).", mustChangePassword },
          { status: 403, headers: NO_STORE_HEADERS }
        );
      }

      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
      recordLoginEvent({ ip, ok: true, method: "password" });

      return NextResponse.json({ success: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    recordLoginEvent({ ip, ok: false, method: "password", detail: "invalid password" });
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
