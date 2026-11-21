/**
 * Live job market fetcher and parser backed by SerpApi google_jobs and disk cache.
 */

import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const CACHE_NAMESPACE = "google_jobs";

function extractQualifications(rawJob) {
  const highlights = Array.isArray(rawJob?.job_highlights) ? rawJob.job_highlights : [];
  const qualifications = [];
  for (const section of highlights) {
    if (section && typeof section === "object" && section.title === "Qualifications") {
      const items = Array.isArray(section.items) ? section.items : [];
      for (const item of items) {
        if (item) qualifications.push(String(item));
      }
    }
  }
  return qualifications;
}

function extractApplyUrl(rawJob) {
  const options = Array.isArray(rawJob?.apply_options) ? rawJob.apply_options : [];
  for (const opt of options) {
    if (opt && typeof opt === "object" && opt.link) {
      return String(opt.link);
    }
  }
  return null;
}

function parseJobPosting(rawJob, index, defaultLocation) {
  const ext = rawJob?.detected_extensions;
  const salaryText =
    ext && typeof ext === "object" && ext.salary != null ? String(ext.salary) : null;
  const title = String(rawJob?.title || "");
  const company = String(rawJob?.company_name || "");
  const jobId = String(rawJob?.job_id || `job-${index}-${company}-${title}`);

  return {
    job_id: jobId,
    title,
    company,
    location: String(rawJob?.location || defaultLocation),
    salary_text: salaryText,
    qualifications: extractQualifications(rawJob),
    description: String(rawJob?.description || ""),
    apply_url: extractApplyUrl(rawJob),
    extracted_skills: [],
  };
}

export async function fetchLiveJobs({
  role,
  location,
  limit = 10,
  useCache = true,
  fetchImpl = fetch,
}) {
  if (limit <= 0) return [];
  loadEnv();

  const searchParams = {
    engine: "google_jobs",
    q: role,
    location,
    gl: "in",
    hl: "en",
  };

  let payload = useCache ? getCached(CACHE_NAMESPACE, searchParams) : null;

  if (payload === null) {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey) {
      throw new Error("SERPAPI_KEY is missing. Set it in your environment or .env file.");
    }

    const url = new URL(SERPAPI_SEARCH_URL);
    for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
      url.searchParams.set(k, String(v));
    }

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`SerpApi request failed with HTTP ${response.status}`);
    }
    payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return [];
    }
    if ("error" in payload) {
      throw new Error(`SerpApi error: ${payload.error}`);
    }
    setCached(CACHE_NAMESPACE, searchParams, payload);
  }

  const rawJobs = Array.isArray(payload.jobs_results) ? payload.jobs_results : [];
  return rawJobs
    .slice(0, limit)
    .filter((item) => item && typeof item === "object")
    .map((item, idx) => parseJobPosting(item, idx, location));
}

export function hasCachedJobsForQuery(role, location) {
  return (
    getCached(CACHE_NAMESPACE, {
      engine: "google_jobs",
      q: role,
      location,
      gl: "in",
      hl: "en",
    }) !== null
  );
}
