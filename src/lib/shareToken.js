import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function secret() {
  if (process.env.MEAI_SHARE_SECRET) return process.env.MEAI_SHARE_SECRET;
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try { return fs.readFileSync(path.join(os.homedir(), ".meai", "jwt-secret"), "utf8").trim(); } catch { return ""; }
}

export function signShareToken(hours = 24, ttlMinutes = 60) {
  const key = secret();
  if (!key) throw new Error("share secret belum tersedia");
  const payload = Buffer.from(JSON.stringify({
    scope: "insights",
    hours: Math.max(1, Math.min(168, Number(hours) || 24)),
    exp: Date.now() + Math.max(5, Math.min(1440, Number(ttlMinutes) || 60)) * 60_000,
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, expiresAt: JSON.parse(Buffer.from(payload, "base64url").toString()).exp };
}

export function verifyShareToken(token) {
  const key = secret();
  if (!key || typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", key).update(payload).digest("base64url");
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.scope !== "insights" || !Number.isFinite(data.exp) || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
