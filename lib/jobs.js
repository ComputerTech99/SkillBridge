/**
 * Live job market fetcher and parser backed by SerpApi google_jobs and disk cache.
 * Supports request timeouts, pagination for limit > 10, remote/schedule badges, and stale-cache fallback.
 */

import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const CACHE_NAMESPACE = "google_jobs";
const REQUEST_TIMEOUT_MS = 15000;

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
  const ext =
    rawJob?.detected_extensions && typeof rawJob.detected_extensions === "object"
      ? rawJob.detected_extensions
      : {};
  const salaryText = ext.salary != null ? String(ext.salary) : null;
  const scheduleType = ext.schedule_type != null ? String(ext.schedule_type) : null;
  const workFromHome = Boolean(ext.work_from_home);

  const title = String(rawJob?.title || "");
  const company = String(rawJob?.company_name || "");
  const jobId = String(rawJob?.job_id || `job-${index}-${company}-${title}`);

  return {
    job_id: jobId,
    title,
    company,
    location: String(rawJob?.location || defaultLocation),
    salary_text: salaryText,
    schedule_type: scheduleType,
    work_from_home: workFromHome,
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
  ttlMs = null,
  fetchImpl = fetch,
}) {
  if (limit <= 0) return [];
  loadEnv();

  const baseParams = {
    engine: "google_jobs",
    q: role,
    location,
    gl: "in",
    hl: "en",
  };

  let payload = useCache ? getCached(CACHE_NAMESPACE, baseParams, { ttlMs }) : null;

  if (payload === null) {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey) {
      // Fallback to any cached snapshot on disk if useCache was false or TTL expired
      const stale = getCached(CACHE_NAMESPACE, baseParams);
      if (stale && useCache) {
        payload = stale;
      } else {
        throw new Error("SERPAPI_KEY is missing. Set it in your environment or .env file.");
      }
    } else {
      const collectedJobs = [];
      let nextPageToken = null;
      let firstPayload = null;
      const maxPages = Math.min(3, Math.ceil(limit / 10));

      for (let page = 0; page < maxPages; page += 1) {
        const pageParams = nextPageToken
          ? { ...baseParams, next_page_token: nextPageToken }
          : baseParams;
        const url = new URL(SERPAPI_SEARCH_URL);
        for (const [k, v] of Object.entries({ ...pageParams, api_key: apiKey })) {
          url.searchParams.set(k, String(v));
        }

        let response;
        try {
          response = await fetchImpl(url.toString(), {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch (err) {
          const stale = getCached(CACHE_NAMESPACE, baseParams);
          if (stale && page === 0) {
            payload = stale;
            break;
          }
          throw err;
        }

        if (!response.ok) {
          throw new Error(`SerpApi request failed with HTTP ${response.status}`);
        }
        const pageData = await response.json();
        if (!pageData || typeof pageData !== "object" || Array.isArray(pageData)) {
          break;
        }
        if ("error" in pageData) {
          throw new Error(`SerpApi error: ${pageData.error}`);
        }

        if (page === 0) firstPayload = pageData;
        const pageJobs = Array.isArray(pageData.jobs_results) ? pageData.jobs_results : [];
        collectedJobs.push(...pageJobs);

        nextPageToken = pageData?.serpapi_pagination?.next_page_token || null;
        if (!nextPageToken || collectedJobs.length >= limit) break;
      }

      if (!payload && firstPayload) {
        payload =
          collectedJobs.length > (firstPayload.jobs_results?.length || 0)
            ? { ...firstPayload, jobs_results: collectedJobs }
            : firstPayload;
        setCached(CACHE_NAMESPACE, baseParams, payload);
      }
    }
  }

  const rawJobs = Array.isArray(payload?.jobs_results) ? payload.jobs_results : [];
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
