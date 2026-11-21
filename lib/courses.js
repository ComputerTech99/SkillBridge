/**
 * Learning resource fetcher (SerpApi YouTube) and weekend mini-project generator.
 */

import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const CACHE_NAMESPACE = "youtube";

function extractCourseResource(item) {
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

async function fetchYoutubeCourses(skill, role, maxResults = 2, fetchImpl = fetch) {
  const searchParams = {
    engine: "youtube",
    search_query: `${skill} full course tutorial for ${role}`,
    gl: "in",
    hl: "en",
  };

  let payload = getCached(CACHE_NAMESPACE, searchParams);
  if (payload === null) {
    const apiKey = (process.env.SERPAPI_KEY || "").trim();
    if (!apiKey) return [];

    const url = new URL(SERPAPI_SEARCH_URL);
    for (const [k, v] of Object.entries({ ...searchParams, api_key: apiKey })) {
      url.searchParams.set(k, String(v));
    }

    try {
      const response = await fetchImpl(url.toString());
      if (!response.ok) return [];
      const data = await response.json();
      if (!data || typeof data !== "object" || "error" in data) return [];
      payload = data;
      setCached(CACHE_NAMESPACE, searchParams, payload);
    } catch {
      return [];
    }
  }

  const candidates = [...(payload.video_results || [])];
  if (candidates.length < maxResults) {
    candidates.push(...(payload.playlist_results || []));
  }

  const resources = [];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const parsed = extractCourseResource(item);
    if (parsed) resources.push(parsed);
    if (resources.length >= maxResults) break;
  }
  return resources;
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
      if (idx >= cutoff) {
        return {
          ...gap,
          courses: Array.isArray(gap.courses) ? gap.courses : [],
          mini_project_idea: gap.mini_project_idea || "",
        };
      }
      const courses = await fetchYoutubeCourses(gap.skill, role, 2, fetchImpl);
      return {
        ...gap,
        courses,
        mini_project_idea: buildMiniProjectIdea(gap.skill, role),
      };
    })
  );
  return enriched;
}
