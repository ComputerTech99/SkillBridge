/**
 * SkillBridge HTTP server (pure Node.js) serving static HTML/CSS/JS and JSON APIs.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getCacheStats } from "./lib/cache.js";
import {
  compareLocalVsRemote,
  compareMultiRoleFit,
  generateAtsBullets,
} from "./lib/compare.js";
import {
  attachLearningResources,
  buildMiniProjectIdea,
  fetchCoursesForSkill,
} from "./lib/courses.js";
import { loadEnv } from "./lib/env.js";
import { fetchLiveJobs, hasCachedJobsForQuery } from "./lib/jobs.js";
import { CITY_OPTIONS, runOfflineDemoAnalysis } from "./lib/offlineDemo.js";
import { cleanResumeText, extractTextFromPdfBuffer } from "./lib/resumeParser.js";
import {
  computeMarketDemand,
  enrichJobsWithSkills,
  extractSkillsFromText,
  getCanonicalSkillsCount,
} from "./lib/skills.js";
import { analyzeSkillGaps } from "./public/js/gap.js";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SAMPLE_RESUMES_PATH = path.join(ROOT_DIR, "data", "sample_resumes.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

const FALLBACK_PRESETS = [
  {
    label: "CS Final-Year Student (Frontend)",
    role: "Frontend Developer",
    city: CITY_OPTIONS[0],
    text:
      "Frontend developer with internship experience in JavaScript (ES6+), HTML5, CSS3, " +
      "React.js, Tailwind CSS, Git, and REST APIs. Built responsive single-page apps.",
  },
  {
    label: "Junior Python Developer (Backend)",
    role: "Backend Python Developer",
    city: CITY_OPTIONS[0],
    text:
      "Backend developer experienced in Python 3, SQL, Flask, Django REST Framework, " +
      "PostgreSQL, SQLite, Git, Linux, REST API, and Agile sprints.",
  },
  {
    label: "Data Science Graduate (Data Analyst)",
    role: "Data Analyst",
    city: CITY_OPTIONS[1],
    text:
      "Entry-level Data Analyst skilled in Python, SQL, Pandas, NumPy, Tableau, and Microsoft Excel.",
  },
];

export function loadSamplePresets() {
  if (fs.existsSync(SAMPLE_RESUMES_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SAMPLE_RESUMES_PATH, "utf8"));
      if (Array.isArray(raw) && raw.length > 0) {
        return raw
          .filter((item) => item && typeof item === "object" && (item.resume_text || item.text))
          .map((item, idx) => ({
            label: String(item.name || item.label || `Sample Resume ${idx + 1}`),
            role: String(item.target_role || item.role || "Backend Python Developer"),
            city: String(item.default_city || item.city || CITY_OPTIONS[0]),
            text: String(item.resume_text || item.text || ""),
          }));
      }
    } catch {
      // Fall back to embedded presets if file is corrupted
    }
  }
  return FALLBACK_PRESETS;
}

const ROLE_SIGNALS = [
  {
    role: "Frontend Developer",
    keywords: ["frontend", "front-end", "react", "javascript", "typescript", "html", "css", "tailwind", "next.js", "vue", "angular", "figma", "ui"],
  },
  {
    role: "Data Analyst",
    keywords: ["data analyst", "analytics", "pandas", "numpy", "tableau", "power bi", "excel", "statistics", "dashboard", "machine learning", "sql"],
  },
  {
    role: "Backend Python Developer",
    keywords: ["backend", "back-end", "python", "django", "flask", "fastapi", "node.js", "express", "postgresql", "mysql", "mongodb", "rest api", "docker", "java", "spring"],
  },
];

/** Pick the closest supported target role from resume keywords. */
export function inferRoleFromResume(resumeText) {
  const text = ` ${String(resumeText || "").toLowerCase()} `;
  let best = ROLE_SIGNALS[2];
  let bestScore = 0;
  for (const signal of ROLE_SIGNALS) {
    let score = 0;
    for (const kw of signal.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = text.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "g"));
      if (matches) score += matches.length;
    }
    if (score > bestScore) {
      best = signal;
      bestScore = score;
    }
  }
  return best.role;
}

async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Request payload exceeds maximum allowed size.");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function serveStaticFile(res, urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const resolved = path.resolve(PUBLIC_DIR, `.${cleanPath}`);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(resolved).pipe(res);
}

async function runLivePipeline({ resumeText, role, location, useCache = true }) {
  const userSkills = await extractSkillsFromText(resumeText);
  const jobs = await fetchLiveJobs({ role, location, limit: 10, useCache });
  const enrichedJobs = await enrichJobsWithSkills(jobs);
  const demandList = computeMarketDemand(enrichedJobs);

  const baseline = analyzeSkillGaps({
    role,
    location,
    userSkills,
    jobs: enrichedJobs,
    demandList,
  });

  const enrichedTopGaps = await attachLearningResources(baseline.missing_gaps, role, 4);
  const coursesBySkill = {};
  for (const gap of enrichedTopGaps) {
    coursesBySkill[gap.skill] = gap;
  }

  const atsBullets = await generateAtsBullets({
    resumeText,
    role,
    matchedSkills: baseline.matched_skills,
    missingGaps: baseline.missing_gaps,
  });

  return {
    role,
    location,
    resumeText,
    analysisMode: "live_or_cached",
    offlineDemoNotice: "",
    userSkills,
    jobs: enrichedJobs,
    demandList,
    baseline,
    coursesBySkill,
    atsBullets,
    cacheStats: getCacheStats(),
  };
}

export function createAppServer() {
  loadEnv();

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const pathname = reqUrl.pathname;

    try {
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          runtime: "nodejs",
          canonicalSkills: getCanonicalSkillsCount(),
          cache: getCacheStats(),
        });
      }

      if (req.method === "GET" && pathname === "/api/presets") {
        return sendJson(res, 200, {
          presets: loadSamplePresets(),
          cities: CITY_OPTIONS,
          cache: getCacheStats(),
        });
      }

      if (req.method === "POST" && pathname === "/api/analyze") {
        const body = await readJsonBody(req);
        let role = String(body.role || "").trim();
        const location = String(body.location || CITY_OPTIONS[0]).trim();
        const mode = String(body.mode || "live");
        const useCache = body.useCache !== false;

        let resumeText = "";
        if (body.pdfBase64) {
          const base64Str = String(body.pdfBase64).replace(/^data:[^;]+;base64,/, "");
          const pdfBuffer = Buffer.from(base64Str, "base64");
          resumeText = await extractTextFromPdfBuffer(pdfBuffer);
        } else {
          resumeText = cleanResumeText(String(body.resumeText || ""));
        }

        if (resumeText.length < 20) {
          return sendJson(res, 400, {
            error: "We couldn't read text from that file. Please upload a text-based PDF resume.",
          });
        }

        if (!role) {
          role = inferRoleFromResume(resumeText);
        }

        if (mode === "offline") {
          const offlineResult = runOfflineDemoAnalysis({ resumeText, role, location });
          const atsBullets = await generateAtsBullets({
            resumeText,
            role,
            matchedSkills: offlineResult.baseline.matched_skills,
            missingGaps: offlineResult.baseline.missing_gaps,
          });
          return sendJson(res, 200, {
            ...offlineResult,
            resumeText,
            atsBullets,
            cacheStats: getCacheStats(),
          });
        }

        if (mode === "quick") {
          const hasLiveOrCache =
            Boolean((process.env.SERPAPI_KEY || "").trim()) ||
            hasCachedJobsForQuery(role, location);
          if (hasLiveOrCache) {
            const result = await runLivePipeline({
              resumeText,
              role,
              location,
              useCache: true,
            });
            return sendJson(res, 200, result);
          }
          const offlineResult = runOfflineDemoAnalysis({ resumeText, role, location });
          const atsBullets = await generateAtsBullets({
            resumeText,
            role,
            matchedSkills: offlineResult.baseline.matched_skills,
            missingGaps: offlineResult.baseline.missing_gaps,
          });
          return sendJson(res, 200, {
            ...offlineResult,
            resumeText,
            atsBullets,
            cacheStats: getCacheStats(),
          });
        }

        const result = await runLivePipeline({ resumeText, role, location, useCache });
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && pathname === "/api/courses") {
        const body = await readJsonBody(req);
        const skill = String(body.skill || "").trim();
        const role = String(body.role || "Software Developer").trim();
        if (!skill) {
          return sendJson(res, 400, { error: "Skill name is required." });
        }
        const courses = await fetchCoursesForSkill(skill, role, 2);
        return sendJson(res, 200, {
          skill,
          courses,
          mini_project_idea: buildMiniProjectIdea(skill, role),
          cacheStats: getCacheStats(),
        });
      }

      if (req.method === "POST" && pathname === "/api/toolkit") {
        const body = await readJsonBody(req);
        const resumeText = cleanResumeText(String(body.resumeText || ""));
        const role = String(body.role || "Frontend Developer").trim();
        const location = String(body.location || CITY_OPTIONS[0]).trim();
        const mode = String(body.mode || "quick");

        if (resumeText.length < 20) {
          return sendJson(res, 400, { error: "Resume text is required for Career Toolkit." });
        }

        const [multiRole, localVsRemote] = await Promise.all([
          compareMultiRoleFit({ resumeText, location, mode }),
          compareLocalVsRemote({ resumeText, role, localCity: location, mode }),
        ]);

        return sendJson(res, 200, {
          multiRole,
          localVsRemote,
          cacheStats: getCacheStats(),
        });
      }

      if (req.method === "GET") {
        return serveStaticFile(res, pathname);
      }

      res.writeHead(405);
      res.end("Method Not Allowed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected server error";
      const status = /missing|invalid|empty|unreadable|serpapi|target role|required/i.test(message)
        ? 400
        : 500;
      sendJson(res, status, { error: message });
    }
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT || 3000);
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`SkillBridge server running at http://localhost:${port}`);
  });
}
