/**
 * Deterministic SHA-256 disk cache storing JSON payloads under data/cache/.
 * Hash format matches Python's json.dumps(sort_keys=True, separators=(",", ":"))
 * so pre-seeded cache files are reused seamlessly.
 * Includes atomic concurrent temp writes, optional TTL expiration, and cache stats.
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

export function getCached(namespace, params, options = {}) {
  const { ttlMs = null } = options || {};
  const cachePath = buildCachePath(namespace, params);
  if (!fs.existsSync(cachePath)) return null;
  try {
    if (typeof ttlMs === "number" && ttlMs > 0) {
      const stat = fs.statSync(cachePath);
      if (Date.now() - stat.mtimeMs > ttlMs) {
        return null;
      }
    }
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
  const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  const tmpPath = `${cachePath}.${uniqueSuffix}`;
  const serialized = JSON.stringify(payload, null, 2);

  fs.writeFileSync(tmpPath, serialized, "utf8");
  try {
    fs.renameSync(tmpPath, cachePath);
  } catch {
    try {
      fs.copyFileSync(tmpPath, cachePath);
    } finally {
      if (fs.existsSync(tmpPath)) {
        fs.rmSync(tmpPath, { force: true });
      }
    }
  }
}

export function getCacheStats() {
  try {
    if (!fs.existsSync(activeCacheDir)) {
      return { totalFiles: 0, totalBytes: 0, lastUpdatedIso: null };
    }
    const entries = fs
      .readdirSync(activeCacheDir)
      .filter((name) => name.endsWith(".json"));
    let totalBytes = 0;
    let latestMtime = 0;
    for (const name of entries) {
      const stat = fs.statSync(path.join(activeCacheDir, name));
      totalBytes += stat.size;
      if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
    }
    return {
      totalFiles: entries.length,
      totalBytes,
      lastUpdatedIso: latestMtime > 0 ? new Date(latestMtime).toISOString() : null,
    };
  } catch {
    return { totalFiles: 0, totalBytes: 0, lastUpdatedIso: null };
  }
}
