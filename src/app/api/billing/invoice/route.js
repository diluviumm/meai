import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getUsageStats } from "@/lib/usageDb";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

const PERIODS = new Set(["today", "7d", "30d"]);
const LABELS = { today: "Hari ini", "7d": "7 hari terakhir", "30d": "30 hari terakhir" };

function idr(value, rate) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format((Number(value) || 0) * rate);
}

function usd(value) {
  return `$${(Number(value) || 0).toFixed(4)}`;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "30d";
  if (!PERIODS.has(period)) return NextResponse.json({ error: "Periode tidak valid" }, { status: 400 });
  try {
    const [stats, settings] = await Promise.all([getUsageStats(period), getSettings()]);
    const rate = Number(settings.usdToIdr) > 0 ? Number(settings.usdToIdr) : 16000;
    const taxPct = Math.max(0, Math.min(100, Number(settings.invoiceTaxPct) || 0));
    const rows = Object.values(stats.byApiKey || {}).sort((a, b) => b.cost - a.cost).slice(0, 18);
    const totalUsd = Number(stats.totalCost) || 0;
    const taxUsd = totalUsd * (taxPct / 100);
    const grandUsd = totalUsd + taxUsd;
    const generated = new Date();
    const invoiceNo = `MEAI/${generated.toISOString().slice(0, 10).replaceAll("-", "")}/${period.toUpperCase()}`;

    if (searchParams.get("format") === "json") {
      return NextResponse.json({ invoiceNo, period, label: LABELS[period], generatedAt: generated.toISOString(), rate, taxPct, totalUsd, taxUsd, grandUsd, rows });
    }

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.12, 0.12, 0.15);
    const muted = rgb(0.42, 0.42, 0.48);
    const accent = rgb(0.36, 0.31, 0.69);
    const line = rgb(0.86, 0.85, 0.9);
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 48;
    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;
    const text = (value, x, size = 9, color = ink, fontFace = font) => page.drawText(String(value ?? ""), { x, y, size, font: fontFace, color });
    const money = (value) => idr(value, rate);
    const newPage = () => {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      page.drawText("MeAI · Rekap Biaya", { x: margin, y: y - 2, size: 9, font: bold, color: muted });
      y -= 30;
    };
    const ensure = (needed) => { if (y - needed < 60) newPage(); };

    page.drawRectangle({ x: 0, y: pageHeight - 118, width: pageWidth, height: 118, color: rgb(0.96, 0.95, 0.99) });
    page.drawText("MeAI", { x: margin, y: pageHeight - 54, size: 24, font: bold, color: accent });
    page.drawText("Rekap Biaya Penggunaan API", { x: margin, y: pageHeight - 76, size: 14, font: bold, color: ink });
    page.drawText("Dokumen internal · bukan faktur pajak resmi", { x: margin, y: pageHeight - 92, size: 8, font, color: muted });
    y = pageHeight - 145;

    text("Nomor", margin, 8, muted); text(invoiceNo, margin + 100, 9, ink);
    text("Tanggal", margin, 8, muted); text(generated.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Makassar" }) + " WITA", margin + 100, 9, ink);
    text("Periode", margin, 8, muted); text(LABELS[period], margin + 100, 9, ink);
    text("Kurs", margin, 8, muted); text(`1 USD = ${new Intl.NumberFormat("id-ID").format(rate)} IDR (estimasi)`, margin + 100, 9, ink);
    y -= 28;
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: line });
    y -= 24;

    text("Rincian per API key", margin, 10, ink, bold);
    y -= 18;
    const cols = [margin, margin + 190, margin + 290, margin + 390, margin + 475];
    ["Label / key", "Request", "Token", "USD", "IDR"].forEach((label, index) => text(label, cols[index], 8, muted, bold));
    y -= 12;
    if (rows.length === 0) {
      text("Belum ada penggunaan pada periode ini.", margin, 9, muted);
      y -= 20;
    }
    for (const row of rows) {
      ensure(24);
      const label = settings.costLabels?.[row.keyName] || row.keyName || row.apiKeyMasked || "Tanpa label";
      const tokens = Number(row.promptTokens || 0) + Number(row.completionTokens || 0);
      text(String(label).slice(0, 30), cols[0], 8, ink);
      text(String(row.requests || 0), cols[1], 8, ink);
      text(new Intl.NumberFormat("id-ID").format(tokens), cols[2], 8, ink);
      text(usd(row.cost), cols[3], 8, ink);
      text(money(row.cost), cols[4], 8, ink);
      y -= 16;
      page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: pageWidth - margin, y: y + 4 }, thickness: 0.4, color: line });
    }

    ensure(100);
    y -= 16;
    const totalsX = pageWidth - margin - 210;
    page.drawRectangle({ x: totalsX, y: y - 66, width: 210, height: 76, color: rgb(0.97, 0.97, 0.99), borderColor: line, borderWidth: 0.6 });
    text("Total penggunaan", totalsX + 12, 9, muted); text(usd(totalUsd), totalsX + 130, 9, ink);
    y -= 20;
    text(`PPN ${taxPct}%`, totalsX + 12, 9, muted); text(usd(taxUsd), totalsX + 130, 9, ink);
    y -= 20;
    text("Total", totalsX + 12, 10, ink, bold); text(money(grandUsd), totalsX + 130, 10, accent, bold);

    y -= 46;
    text("Catatan", margin, 9, ink, bold);
    y -= 14;
    text("Rekap ini dihitung dari usageHistory dan pricing yang tercatat di MeAI.", margin, 8, muted);
    y -= 12;
    text("PPN bersifat opsional (setting invoiceTaxPct); dokumen ini bukan faktur pajak resmi.", margin, 8, muted);
    y -= 12;
    text("Label biaya dapat diubah di Governance → Cost allocation.", margin, 8, muted);

    const pages = pdf.getPages();
    pages.forEach((item, index) => {
      item.drawText(`MeAI · halaman ${index + 1}/${pages.length}`, { x: margin, y: 28, size: 8, font, color: muted });
      item.drawText(invoiceNo, { x: pageWidth - margin - 120, y: 28, size: 8, font, color: muted });
    });

    const bytes = await pdf.save();
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="meai-invoice-${period}-${generated.toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[invoice]", error);
    return NextResponse.json({ error: error.message || "Gagal membuat invoice" }, { status: 500 });
  }
}
