// scripts/build-images.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import sharp from "sharp";

const SHEET_ID = process.env.SHEET_ID;           // provided via workflow env
const SHEET_TAB = process.env.SHEET_TAB || "VRBO";
const OUT_DIR = process.env.OUT_DIR || "images";

// Public CSV export for a single tab:
const csvUrl =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

function sha1_16(str) {
  return crypto.createHash("sha1").update(str).digest("hex").slice(0, 16);
}

async function main() {
  if (!SHEET_ID) {
    console.error("Missing SHEET_ID env var.");
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) Fetch CSV from the VRBO tab
  const res = await fetch(csvUrl);
  if (!res.ok) {
    console.error("CSV fetch failed:", res.status, await res.text());
    process.exit(1);
  }
  const csv = await res.text();
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  // Expect the column name exactly: "Main Image URL"
  const MAIN_COL = "Main Image URL";

  for (const row of rows) {
    const src = (row[MAIN_COL] || "").trim();
    if (!src) continue;

    // Deterministic filename from source URL
    const id = sha1_16(src);
    const outPath = path.join(OUT_DIR, `${id}.jpg`);
    if (fs.existsSync(outPath)) {
      console.log("Skip exists:", outPath);
      continue;
    }

    try {
      // 2) Download original image
      const imgRes = await fetch(src, { redirect: "follow" });
      if (!imgRes.ok) {
        console.warn("Image fetch failed:", imgRes.status, src);
        continue;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());

      // 3) Crop to 575x325 (cover)
      const outBuf = await sharp(buf)
        .resize(575, 325, { fit: "cover", position: "attention" }) // or "centre"
        .jpeg({ quality: 85 })
        .toBuffer();

      // 4) Save to /images
      fs.writeFileSync(outPath, outBuf);
      console.log("Wrote", outPath);
    } catch (e) {
      console.error("Error processing:", src, e.message);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
