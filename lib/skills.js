/**
 * Hybrid Gemini + regex-alias technical skill extraction and market demand aggregation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SKILLS_LIST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "skills_list.json"
);

const GEMINI_CACHE_MODEL = "gemini-3.5-flash-lite";
const GEMINI_FALLBACK_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadSkillsCatalog() {
  const rawCatalog = JSON.parse(fs.readFileSync(SKILLS_LIST_PATH, "utf8"));
  const aliasToCanonical = new Map();
  const compiledPatterns = [];

  for (const [canonical, aliases] of Object.entries(rawCatalog)) {
    aliasToCanonical.set(canonical.toLowerCase(), canonical);
    const seen = new Set();
    const uniqueTerms = [];

    for (const term of [canonical, ...(aliases || [])]) {
      const cleaned = String(term).trim();
      const lowered = cleaned.toLowerCase();
      if (cleaned && !seen.has(lowered)) {
        seen.add(lowered);
        uniqueTerms.push(cleaned);
        aliasToCanonical.set(lowered, canonical);
      }
    }

    uniqueTerms.sort((a, b) => b.length - a.length);
    const escaped = uniqueTerms.map(escapeRegExp).join("|");
    // Lookarounds instead of \b so symbol-containing skills (C++, C#, .NET) match accurately.
    const pattern = new RegExp(`(?<!\\w)(?:${escaped})(?!\\w)`, "i");
    compiledPatterns.push({ canonical, pattern });
  }

  return { rawCatalog, aliasToCanonical, compiledPatterns };
}

const { rawCatalog, aliasToCanonical, compiledPatterns } = loadSkillsCatalog();

export function deduplicateAndNormalize(skills) {
  const result = [];
  const seen = new Set();

  for (const raw of skills || []) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.trim();
    if (!cleaned) continue;
    const canonical = aliasToCanonical.get(cleaned.toLowerCase()) || cleaned;
    const key = canonical.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(canonical);
    }
  }
  return result;
}

export function extractSkillsRegex(text) {
  if (!text || !text.trim()) return [];
  const matched = [];
  for (const { canonical, pattern } of compiledPatterns) {
    if (pattern.test(text)) {
      matched.push(canonical);
    }
  }
  return deduplicateAndNormalize(matched);
}

async function extractSkillsLLM(text, apiKey, fetchImpl = fetch) {
  const cacheParams = { model: GEMINI_CACHE_MODEL, text };
  const cached = getCached("gemini_skills", cacheParams);
  if (cached && Array.isArray(cached.skills)) {
    return deduplicateAndNormalize(cached.skills.map(String));
  }

  const canonicalNames = Object.keys(rawCatalog).join(", ");
  const prompt =
    "Extract all technical skills, programming languages, frameworks, databases, " +
    "cloud platforms, DevOps tools, and engineering concepts explicitly mentioned in " +
    "the text below.\n" +
    "Normalize aliases to their canonical names whenever applicable using this " +
    `reference taxonomy: [${canonicalNames}].\n` +
    "Return ONLY a JSON array of deduplicated canonical skill strings. Do not invent " +
    "skills that are not present in the text.\n\n" +
    `Text:\n${text}`;

  let lastError = null;
  for (const modelName of GEMINI_FALLBACK_MODELS) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Gemini HTTP ${response.status}`);
      }
      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        throw new Error("Gemini response was not a JSON array");
      }

      const normalized = deduplicateAndNormalize(parsed.map(String));
      setCached("gemini_skills", cacheParams, { skills: normalized });
      return normalized;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("All Gemini models failed");
}

export async function extractSkillsFromText(text, fetchImpl = fetch) {
  if (!text || !text.trim()) return [];
  loadEnv();

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (apiKey) {
    try {
      return await extractSkillsLLM(text, apiKey, fetchImpl);
    } catch {
      // Fallback transparently to regex matching
    }
  }
  return extractSkillsRegex(text);
}

export async function enrichJobsWithSkills(jobs, fetchImpl = fetch) {
  if (!Array.isArray(jobs) || jobs.length === 0) return jobs || [];

  const texts = jobs.map((job) =>
    [...(job.qualifications || []), job.description || ""]
      .filter((part) => part && part.trim())
      .join("\n")
  );

  // Run bounded batches of 5 concurrently
  const results = new Array(jobs.length);
  const concurrency = 5;
  for (let start = 0; start < jobs.length; start += concurrency) {
    const slice = texts.slice(start, start + concurrency);
    const batch = await Promise.all(
      slice.map((t) => extractSkillsFromText(t, fetchImpl))
    );
    batch.forEach((skills, offset) => {
      results[start + offset] = skills;
    });
  }

  return jobs.map((job, idx) => ({
    ...job,
    extracted_skills: results[idx] || [],
  }));
}

export function computeMarketDemand(jobs) {
  const totalJobs = Array.isArray(jobs) ? jobs.length : 0;
  if (totalJobs === 0) return [];

  const skillJobIds = new Map();
  const skillSeenJobs = new Map();

  for (const job of jobs) {
    for (const skill of deduplicateAndNormalize(job.extracted_skills || [])) {
      if (!skillJobIds.has(skill)) {
        skillJobIds.set(skill, []);
        skillSeenJobs.set(skill, new Set());
      }
      const seenSet = skillSeenJobs.get(skill);
      if (!seenSet.has(job.job_id)) {
        seenSet.add(job.job_id);
        skillJobIds.get(skill).push(job.job_id);
      }
    }
  }

  const demands = [];
  for (const [skill, jobIds] of skillJobIds.entries()) {
    demands.push({
      skill,
      job_count: jobIds.length,
      total_jobs: totalJobs,
      demand_pct: Math.round((jobIds.length / totalJobs) * 10000) / 100,
      unlocked_job_ids: jobIds,
    });
  }

  demands.sort((a, b) => {
    if (b.job_count !== a.job_count) return b.job_count - a.job_count;
    return a.skill.toLowerCase().localeCompare(b.skill.toLowerCase());
  });
  return demands;
}
