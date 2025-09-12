// scripts/build-images.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import sharp from "sharp";

// --- Fixed for your spreadsheet ---
const SHEET_ID = "1Igj7ohYqH3TnrESbSQwMSRLMx2tfOqDwmoXEzrNarag";

// --- From env (with sensible defaults) ---
const SHEET_TAB = process.env.SHEET_TAB || "VRBO";
const OUT_DIR   = process.env.OUT_DIR   || "images/vrbo"; // subfolder to avoid collisions
const WIDTH     = parseInt(process.env.WIDTH  || (SHEET_TAB === "ETSY" ? "325" : "575"), 10);
const HEIGHT    = parseInt(process.env.HEIGHT || (SHEET_TAB === "ETSY" ? "575" : "325"), 10);

// Public CSV export URL for the tab
const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

function sha1_16(str) {
  return crypto.createHash("sha1").update(str).digest("hex").slice(0, 16);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) Fetch CSV
  const res = await fetch(csvUrl);
  if (!res.ok) {
    console.error("CSV fetch failed:", res.status, await res.text());
    process.exit(1);
  }
  const csv = await res.text();
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  const MAIN_COL = "Main Image URL"; // header must match exactly

  for (const row of rows) {
    const src = (row[MAIN_COL] || "").trim();
    if (!src) continue;

    const id = sha1_16(src);
    const outPath = path.join(OUT_DIR, `${id}.jpg`);
    if (fs.existsSync(outPath)) {
      console.log(`[${SHEET_TAB}] Skip exists:`, outPath);
      continue;
    }

    try {
      const imgRes = await fetch(src, { redirect: "follow", headers: { "User-Agent": "img-bot" } });
      if (!imgRes.ok) {
        console.warn(`[${SHEET_TAB}] Fetch failed ${imgRes.status}:`, src);
        continue;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());

      const outBuf = await sharp(buf)
        .resize(WIDTH, HEIGHT, { fit: "cover", position: "attention" }) // or "centre"
        .jpeg({ quality: 85 })
        .toBuffer();

      fs.writeFileSync(outPath, outBuf);
      console.log(`[${SHEET_TAB}] Wrote`, outPath);
    } catch (e) {
      console.error(`[${SHEET_TAB}] Error:`, src, e.message);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
