/**
 * Deterministic SHA-256 disk cache storing JSON payloads under data/cache/.
 * Hash format matches Python's json.dumps(sort_keys=True, separators=(",", ":"))
 * so existing pre-seeded cache files are reused seamlessly.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CACHE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "cache"
);

let activeCacheDir = DEFAULT_CACHE_DIR;

export function getCacheDir() {
  return activeCacheDir;
}

export function setCacheDir(dirPath) {
  activeCacheDir = path.resolve(dirPath);
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortObjectKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function buildCachePath(namespace, params) {
  fs.mkdirSync(activeCacheDir, { recursive: true });
  const filtered = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k !== "api_key") filtered[k] = v;
  }
  const canonicalParams = JSON.stringify(sortObjectKeys(filtered));
  const digest = crypto
    .createHash("sha256")
    .update(`${namespace}:${canonicalParams}`, "utf8")
    .digest("hex");
  return path.join(activeCacheDir, `${digest}.json`);
}

export function getCached(namespace, params) {
  const cachePath = buildCachePath(namespace, params);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function setCached(namespace, params, payload) {
  const cachePath = buildCachePath(namespace, params);
  const tmpPath = `${cachePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpPath, cachePath);
}
