// scripts/build-images.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import sharp from "sharp";

// ---- Your Google Sheet ----
const SHEET_ID = "1Igj7ohYqH3TnrESbSQwMSRLMx2tfOqDwmoXEzrNarag";

// ---- Matrix / env config (set by the workflow) ----
const SHEET_TAB = process.env.SHEET_TAB || "VRBO";
const OUT_DIR   = process.env.OUT_DIR   || (SHEET_TAB === "ETSY" ? "images/etsy" : "images/vrbo");
const WIDTH     = parseInt(process.env.WIDTH  || (SHEET_TAB === "ETSY" ? "325" : "575"), 10);
const HEIGHT    = parseInt(process.env.HEIGHT || (SHEET_TAB === "ETSY" ? "575" : "575"), 10);

// Header mapping per tab (this was the issue)
const SOURCE_HEADER_BY_TAB = {
  VRBO: "Main Image URL",
  ETSY: "Product Image URL",
};

const SRC_HEADER = SOURCE_HEADER_BY_TAB[SHEET_TAB] || "Main Image URL";

// Public CSV export URL for the tab
const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

function sha1_16(str) {
  return crypto.createHash("sha1").update(str).digest("hex").slice(0, 16);
}

async function fetchCsvText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "img-bot" } });
  if (!res.ok) throw new Error(`CSV fetch failed: HTTP ${res.status}`);
  return await res.text();
}

async function fetchImageBuffer(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "img-bot" } });
  if (!r.ok) throw new Error(`Image fetch failed: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  console.log(`=== START ${SHEET_TAB} (${WIDTH}x${HEIGHT}) ===`);
  console.log(`CSV: ${csvUrl}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) Fetch & parse CSV
  const csv = await fetchCsvText(csvUrl);
  const rows = parse(csv, { columns: true, skip_empty_lines: true });
  console.log(`[${SHEET_TAB}] Rows parsed: ${rows.length}`);

  if (rows.length === 0) {
    console.error(`[${SHEET_TAB}] No rows found. Is the "${SHEET_TAB}" tab published to CSV?`);
    process.exit(1);
  }

  if (!(SRC_HEADER in rows[0])) {
    console.error(`[${SHEET_TAB}] Column "${SRC_HEADER}" not found. Headers present:`, Object.keys(rows[0]));
    process.exit(1);
  }

  // 2) Process rows
  const manifest = [];
  let processed = 0;

  for (const row of rows) {
    const src = String(row[SRC_HEADER] || "").trim();
    if (!src) {
      manifest.push({ status: "skip-no-src" });
      continue;
    }

    const id = sha1_16(src);                        // must match your Apps Script hashing
    const outPath = path.join(OUT_DIR, `${id}.jpg`);

    if (fs.existsSync(outPath)) {
      manifest.push({ id, src, file: `${OUT_DIR}/${id}.jpg`, status: "exists" });
      continue;
    }

    try {
      const buf = await fetchImageBuffer(src);
      const outBuf = await sharp(buf)
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" }) // or "centre"
        .jpeg({ quality: 85 })
        .toBuffer();

      fs.writeFileSync(outPath, outBuf);
      processed++;
      manifest.push({ id, src, file: `${OUT_DIR}/${id}.jpg`, status: "written" });
      console.log(`[${SHEET_TAB}] Wrote ${outPath}`);
    } catch (e) {
      manifest.push({ id, src, file: `${OUT_DIR}/${id}.jpg`, status: `error: ${e.message}` });
      console.error(`[${SHEET_TAB}] ERROR ${src}: ${e.message}`);
    }
  }

  // 3) Write a manifest for quick inspection
  const manifestPath = path.join(OUT_DIR, "_manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[${SHEET_TAB}] Manifest written: ${manifestPath}`);
  console.log(`[${SHEET_TAB}] Done. New/updated files: ${processed}`);
}

main().catch((e) => {
  console.error(`[${SHEET_TAB}] Uncaught error:`, e);
  process.exit(1);
});
