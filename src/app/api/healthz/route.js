import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "meai-mael-stack",
    // Ronde-36: baca dari package.json saat build — fallback env
    // npm_package_version TIDAK ada saat jalan sebagai systemd unit,
    // sehingga versi selalu jatuh ke literal lama yang basi.
    version: pkg.version,
    uptime_s: Math.round(process.uptime()),
    ts: new Date().toISOString(),
  });
}
