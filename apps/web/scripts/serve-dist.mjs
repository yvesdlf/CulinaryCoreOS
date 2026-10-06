// ---------------------------------------------------------------------------
// Serve the production build the way Vercel will
// ---------------------------------------------------------------------------
// The production bundle once loaded to a blank page — two vendor chunks
// imported each other — while every check stayed green, because they all ran
// the dev server or only built. This serves `dist` with the headers from
// vercel.json, CSP included, so the smoke test sees what a venue would.
//
// The one difference from production: the local Supabase API is plain http,
// so its origin is added to connect-src. Pass it as LOCAL_API_ORIGIN.
//
//   node scripts/serve-dist.mjs            # port 4173
// ---------------------------------------------------------------------------

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../dist");
const vercel = JSON.parse(fs.readFileSync(path.resolve(here, "../../../vercel.json"), "utf8"));
const headers = vercel.headers.find((h) => h.source === "/(.*)").headers;
const local = process.env.LOCAL_API_ORIGIN ?? "http://127.0.0.1:54321";
const port = Number(process.env.PORT ?? 4173);

const types = {
  ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

http.createServer((req, res) => {
  for (const { key, value } of headers) {
    res.setHeader(key, key === "Content-Security-Policy"
      ? value.replace("connect-src 'self'", `connect-src 'self' ${local} ${local.replace(/^http/, "ws")}`)
      : value);
  }
  let file = path.join(root, decodeURIComponent((req.url ?? "/").split("?")[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, "index.html"); // the SPA rewrite vercel.json declares
  }
  res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`dist on http://localhost:${port}`));
