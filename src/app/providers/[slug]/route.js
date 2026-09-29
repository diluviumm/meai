// Ronde-39 — penutup 404 ikon provider.
//
// Halaman daftar provider memanggil `/providers/<id>.png` untuk SEMUA 376
// provider, padahal `public/providers/` hanya berisi 173 aset → 224 permintaan
// berakhir 404 dan membanjiri console (sweep menangkapnya di 3 viewport).
//
// `ProviderIcon` sudah menampilkan avatar huruf berwarna saat gambar gagal,
// jadi yang dibutuhkan hanya MENGHAPUS 404-nya: bila berkas nyata ada, static
// file Next yang menanganinya (public/ dicek sebelum app router); route ini hanya
// dipanggil ketika berkasnya tidak ada, dan membalas 204 tanpa isi sehingga
// <img> langsung jatuh ke fallback — tanpa error console.
import { access } from "node:fs/promises";
import path from "node:path";

const ICON_DIR = path.join(process.cwd(), "public", "providers");

export async function GET(_request, { params }) {
  const { slug = "" } = await params;
  // hanya izinkan nama berkas yang masuk akal (anti path traversal)
  const name = String(slug).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!name) return new Response(null, { status: 204 });

  const file = path.join(ICON_DIR, name.endsWith(".png") ? name : `${name}.png`);
  try {
    await access(file);
    // Berkas ada → biarkan public/ yang menyajikan (jalur ini tidak seharusnya
    // tercapai; ini pengaman bila urutan serving berubah).
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(file);
    return new Response(buf, {
      headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
    });
  } catch {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "public, max-age=3600" },
    });
  }
}
