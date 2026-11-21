/**
 * Learning resource fetcher (SerpApi YouTube + Google Search official docs fallback)
 * and weekend proof-of-work mini-project generator.
 */

import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const YT_CACHE_NAMESPACE = "youtube";
const GOOGLE_CACHE_NAMESPACE = "google_docs";
const REQUEST_TIMEOUT_MS = 15000;

function extractYoutubeResource(item) {
  const title = String(item?.title || "").trim();
  const link = String(item?.link || "").trim();
  if (!title || !link) return null;

  const rawChannel = item?.channel;
  let channelName = "YouTube";
  if (rawChannel && typeof rawChannel === "object") {
    channelName = String(rawChannel.name || "YouTube");
  } else if (typeof rawChannel === "string" && rawChannel.trim()) {
    channelName = rawChannel.trim();
  }

  let duration = null;
  if (item?.length) {
    duration = String(item.length);
  } else if (item?.video_count) {
    duration = `${item.video_count} videos`;
  }

  const rawThumb = item?.thumbnail;
  let thumbnail = null;
  if (rawThumb && typeof rawThumb === "object") {
    thumbnail = rawThumb.static || rawThumb.rich || null;
  } else if (typeof rawThumb === "string" && rawThumb.trim()) {
    thumbnail = rawThumb.trim();
  }

  return {
    title,
    url: link,
    source: "YouTube",
    channel_or_site: channelName,
    duration,
    thumbnail,
  };
}

function extractGoogleOrganicResource(item) {
  const title = String(item?.title || "").trim();
  const link = String(item?.link || "").trim();
  if (!title || !link) return null;

  let siteName = String(item?.source || "").trim();
  if (!siteName) {
    try {
      siteName = new URL(link).hostname.replace(/^www\./, "");
    } catch {
      siteName = "Official Docs";
    }
  }

  return {
    title,
    url: link,
    source: "Google Search",
    channel_or_site: siteName,
    duration: "Docs & Guide",
    thumbnail: null,
  };
}

export async function fetchGoogleDocsFallback(
  skill,
  role,
  maxResults = 2,
  fetchImpl = fetch
) {
  const searchParams = {
    engine: "google",
    q: `${skill} official documentation tutorial for ${role}`,
    gl: "in",
    hl: "en",
  };

  let payload = getCached(GOOGLE_CACHE_NAMESPACE, searchParams);
  if (payload === null) {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey) return [];

    const url = new URL(SERPAPI_SEARCH_URL);
    for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
      url.searchParams.set(k, String(v));
    }

    try {
      const response = await fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return [];
      const data = await response.json();
      if (!data || typeof data !== "object" || "error" in data) return [];
      payload = data;
      setCached(GOOGLE_CACHE_NAMESPACE, searchParams, payload);
    } catch {
      return [];
    }
  }

  const organic = Array.isArray(payload?.organic_results)
    ? payload.organic_results
    : [];
  const resources = [];
  for (const item of organic) {
    if (!item || typeof item !== "object") continue;
    const parsed = extractGoogleOrganicResource(item);
    if (parsed) resources.push(parsed);
    if (resources.length >= maxResults) break;
  }
  return resources;
}

export async function fetchCoursesForSkill(
  skill,
  role,
  maxResults = 2,
  fetchImpl = fetch
) {
  loadEnv();
  const searchParams = {
    engine: "youtube",
    search_query: `${skill} full course tutorial for ${role}`,
    gl: "in",
    hl: "en",
  };

  let payload = getCached(YT_CACHE_NAMESPACE, searchParams);
  if (payload === null) {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (apiKey) {
      const url = new URL(SERPAPI_SEARCH_URL);
      for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
        url.searchParams.set(k, String(v));
      }

      try {
        const response = await fetchImpl(url.toString(), {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) {
          const data = await response.json();
          if (data && typeof data === "object" && !("error" in data)) {
            payload = data;
            setCached(YT_CACHE_NAMESPACE, searchParams, payload);
          }
        }
      } catch {
        // Proceed to fallback
      }
    }
  }

  const resources = [];
  if (payload) {
    const candidates = [...(payload.video_results || [])];
    if (candidates.length < maxResults) {
      candidates.push(...(payload.playlist_results || []));
    }

    for (const item of candidates) {
      if (!item || typeof item !== "object") continue;
      const parsed = extractYoutubeResource(item);
      if (parsed) resources.push(parsed);
      if (resources.length >= maxResults) break;
    }
  }

  // Fallback to SerpApi Google Search organic_results when YouTube returns 0 results
  if (resources.length === 0) {
    const googleDocs = await fetchGoogleDocsFallback(
      skill,
      role,
      maxResults,
      fetchImpl
    );
    resources.push(...googleDocs);
  }

  return resources.slice(0, maxResults);
}

export function buildMiniProjectIdea(skill, role) {
  const templates = {
    docker:
      `Containerize a realistic ${role} service using a multi-stage Dockerfile and Docker ` +
      `Compose setup with a local datastore. Publish the repo with one-command startup ` +
      `and healthcheck verification to prove production-ready Docker skills.`,
    kubernetes:
      `Deploy a containerized ${role} application onto a local Kubernetes cluster (Minikube ` +
      `or kind) with Deployment, Service, and readiness probe manifests. Document scaling ` +
      `and rolling-update tests in your GitHub README as hands-on Kubernetes proof.`,
    postgresql:
      `Design a normalized PostgreSQL schema with migrations and composite indexes for a ` +
      `core ${role} workflow. Share sample queries with EXPLAIN ANALYZE benchmarks in your ` +
      `repository to demonstrate practical PostgreSQL tuning.`,
    redis:
      `Integrate Redis caching and rate-limiting into a ${role} API to speed up repeated ` +
      `reads and protect hot endpoints. Include before-and-after latency benchmarks in your ` +
      `README to showcase measurable Redis impact.`,
    aws:
      `Build and deploy a small ${role} workload on AWS using free-tier services such as ` +
      `S3, Lambda, or EC2 with least-privilege IAM policies. Add an architecture diagram ` +
      `and reproducible setup steps to prove real AWS deployment experience.`,
    "ci/cd":
      `Set up a GitHub Actions CI/CD pipeline for a ${role} project that runs linting, ` +
      `unit tests, and automated build checks on every pull request. Add status badges and ` +
      `a sample failing-to-passing PR log to demonstrate reliable CI/CD automation.`,
    typescript:
      `Refactor a ${role} module into strict TypeScript with typed API contracts, discriminated ` +
      `unions, and zero 'any' types. Ship a GitHub repo with tsc type-check CI to prove type-safe engineering.`,
    fastapi:
      `Build an async FastAPI service for a ${role} use case featuring Pydantic v2 validation, ` +
      `OpenAPI docs, and dependency-injected database sessions. Include pytest async endpoint tests in your README.`,
    "next.js":
      `Create a responsive ${role} web app in Next.js using server-rendered routes, dynamic metadata, ` +
      `and API route handlers. Deploy a live preview link and document Lighthouse performance scores.`,
    "power bi":
      `Build an interactive Power BI executive dashboard for a ${role} dataset using DAX calculated ` +
      `measures, star-schema modeling, and drill-through filters. Publish screenshots and your .pbix data model notes on GitHub.`,
    jest:
      `Add a Jest unit and integration test suite covering edge cases, mocks, and >85% branch coverage ` +
      `for a ${role} codebase. Include coverage badges and test output logs in your repository.`,
    cypress:
      `Write end-to-end Cypress browser tests for a ${role} application covering critical user flows, ` +
      `network intercepts, and form validations. Commit a headless CI test video or screenshot artifact to GitHub.`,
    playwright:
      `Automate cross-browser end-to-end tests with Playwright for a ${role} web app including trace-viewer ` +
      `artifacts and API mocking. Document how to run the suite headlessly in a single command.`,
    microservices:
      `Split a monolithic ${role} workflow into two decoupled microservices communicating via REST or message ` +
      `events with independent healthchecks. Document service boundaries and failure recovery in your README.`,
    llm:
      `Build a domain-specific ${role} assistant powered by structured LLM JSON outputs, prompt guardrails, ` +
      `and deterministic fallback logic. Benchmark accuracy and latency across 10 test cases in your repo.`,
  };

  return (
    templates[skill.toLowerCase()] ||
    `Build a focused ${role} weekend project centered on ${skill} that solves one real ` +
      `workflow end to end with clean sample data. Publish it on GitHub with automated checks ` +
      `and a concise README showing how ${skill} improves the solution.`
  );
}

export async function attachLearningResources(
  gaps,
  role,
  topN = 4,
  fetchImpl = fetch
) {
  loadEnv();
  const cutoff = Math.max(0, topN);

  const enriched = await Promise.all(
    (gaps || []).map(async (gap, idx) => {
      const miniProject = gap.mini_project_idea || buildMiniProjectIdea(gap.skill, role);
      if (idx >= cutoff) {
        return {
          ...gap,
          courses: Array.isArray(gap.courses) ? gap.courses : [],
          mini_project_idea: miniProject,
        };
      }
      const courses = await fetchCoursesForSkill(gap.skill, role, 2, fetchImpl);
      return {
        ...gap,
        courses,
        mini_project_idea: miniProject,
      };
    })
  );
  return enriched;
}
