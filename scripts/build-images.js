// scripts/build-images.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import fetch from "node-fetch";
import { parse } from "csv-parse/sync";
import sharp from "sharp";

// --- Your Google Sheet details ---
const SHEET_ID = "1Igj7ohYqH3TnrESbSQwMSRLMx2tfOqDwmoXEzrNarag";  // fixed sheet ID
const SHEET_TAB = "VRBO";                                        // tab name
const OUT_DIR = "images";                                        // output folder

// Public CSV export URL for the VRBO tab
const csvUrl =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

// Generate a short 16-character SHA-1 hash from a string
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

  // The column header in your sheet
  const MAIN_COL = "Main Image URL";

  for (const row of rows) {
    const src = (row[MAIN_COL] || "").trim();
    if (!src) continue;

    // Deterministic filename
    const id = sha1_16(src);
    const outPath = path.join(OUT_DIR, `${id}.jpg`);

    // Skip if we already have the processed file
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

      // 3) Resize + crop to 575×325
      const outBuf = await sharp(buf)
        .resize(575, 325, { fit: "cover", position: "attention" }) // or "centre"
        .jpeg({ quality: 85 })
        .toBuffer();

      // 4) Save processed file
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
