/**
 * SkillBridge HTTP server (pure Node.js) serving static HTML/CSS/JS and JSON APIs.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attachLearningResources } from "./lib/courses.js";
import { loadEnv } from "./lib/env.js";
import { fetchLiveJobs, hasCachedJobsForQuery } from "./lib/jobs.js";
import { CITY_OPTIONS, runOfflineDemoAnalysis } from "./lib/offlineDemo.js";
import { cleanResumeText, extractTextFromPdfBuffer } from "./lib/resumeParser.js";
import {
  computeMarketDemand,
  enrichJobsWithSkills,
  extractSkillsFromText,
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

  // Prevent path traversal outside public/
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

async function runLivePipeline({ resumeText, role, location }) {
  const userSkills = await extractSkillsFromText(resumeText);
  const jobs = await fetchLiveJobs({ role, location, limit: 10, useCache: true });
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
  for (const gap of enrichedTopGaps.slice(0, 4)) {
    coursesBySkill[gap.skill] = gap;
  }

  return {
    role,
    location,
    analysisMode: "live_or_cached",
    offlineDemoNotice: "",
    userSkills,
    jobs: enrichedJobs,
    demandList,
    baseline,
    coursesBySkill,
  };
}

export function createAppServer() {
  loadEnv();

  return http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || "/", "http://localhost");
    const pathname = reqUrl.pathname;

    try {
      if (req.method === "GET" && pathname === "/api/health") {
        return sendJson(res, 200, { ok: true, runtime: "nodejs" });
      }

      if (req.method === "GET" && pathname === "/api/presets") {
        return sendJson(res, 200, {
          presets: loadSamplePresets(),
          cities: CITY_OPTIONS,
        });
      }

      if (req.method === "POST" && pathname === "/api/analyze") {
        const body = await readJsonBody(req);
        const role = String(body.role || "").trim();
        const location = String(body.location || CITY_OPTIONS[0]).trim();
        const mode = String(body.mode || "live");

        if (!role) {
          return sendJson(res, 400, { error: "Please enter a Target Role." });
        }

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
            error: "Please choose a sample preset, paste at least 20 characters, or upload a readable PDF.",
          });
        }

        if (mode === "offline") {
          const result = runOfflineDemoAnalysis({ resumeText, role, location });
          return sendJson(res, 200, result);
        }

        if (mode === "quick") {
          const hasLiveOrCache =
            Boolean((process.env.SERPAPI_KEY || "").trim()) ||
            hasCachedJobsForQuery(role, location);
          const result = hasLiveOrCache
            ? await runLivePipeline({ resumeText, role, location })
            : runOfflineDemoAnalysis({ resumeText, role, location });
          return sendJson(res, 200, result);
        }

        const result = await runLivePipeline({ resumeText, role, location });
        return sendJson(res, 200, result);
      }

      if (req.method === "GET") {
        return serveStaticFile(res, pathname);
      }

      res.writeHead(405);
      res.end("Method Not Allowed");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected server error";
      const status = /missing|invalid|empty|unreadable|serpapi|target role/i.test(message)
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
