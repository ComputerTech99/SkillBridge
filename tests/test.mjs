import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getCacheDir,
  getCacheStats,
  getCached,
  setCacheDir,
  setCached,
} from "../lib/cache.js";
import {
  compareLocalVsRemote,
  compareMultiRoleFit,
  generateAtsBullets,
} from "../lib/compare.js";
import { attachLearningResources, fetchCoursesForSkill } from "../lib/courses.js";
import { loadEnv } from "../lib/env.js";
import { fetchLiveJobs } from "../lib/jobs.js";
import { runOfflineDemoAnalysis } from "../lib/offlineDemo.js";
import { cleanResumeText, extractTextFromPdfBuffer } from "../lib/resumeParser.js";
import {
  computeMarketDemand,
  deduplicateAndNormalize,
  extractSkillsRegex,
} from "../lib/skills.js";
import { analyzeSkillGaps } from "../public/js/gap.js";
import { createAppServer } from "../server.js";

test("cache supports concurrent writes, TTL expiration, stats, and corruption recovery", async () => {
  const origDir = getCacheDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cache-"));
  try {
    setCacheDir(tmpDir);
    assert.equal(getCached("google_jobs", { q: "backend", api_key: "k1" }), null);

    // Concurrent writes to the exact same key must not race on .tmp file
    await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        Promise.resolve().then(() =>
          setCached(
            "google_jobs",
            { location: "Bengaluru", q: "backend", api_key: `k${idx}` },
            { ok: idx }
          )
        )
      )
    );

    const hit = getCached("google_jobs", {
      q: "backend",
      location: "Bengaluru",
      api_key: "other",
    });
    assert.ok(hit && typeof hit.ok === "number");

    // TTL expiration test (backdate mtime by 10 seconds and test ttlMs: 1000)
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const filePath = path.join(tmpDir, files[0]);
    const pastTime = new Date(Date.now() - 10000);
    fs.utimesSync(filePath, pastTime, pastTime);
    assert.equal(
      getCached("google_jobs", { q: "backend", location: "Bengaluru" }, { ttlMs: 1000 }),
      null
    );
    assert.ok(
      getCached("google_jobs", { q: "backend", location: "Bengaluru" }, { ttlMs: 60000 })
    );

    const stats = getCacheStats();
    assert.equal(stats.totalFiles, 1);
    assert.ok(stats.totalBytes > 0);

    // Corrupted JSON returns null gracefully
    fs.writeFileSync(filePath, "{not-valid-json", "utf8");
    assert.equal(getCached("google_jobs", { q: "backend", location: "Bengaluru" }), null);
  } finally {
    setCacheDir(origDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadEnv respects explicitly empty process.env variables without overwriting", () => {
  const prev = process.env.SERPAPI_KEY;
  try {
    process.env.SERPAPI_KEY = "";
    loadEnv();
    assert.equal(process.env.SERPAPI_KEY, "");
  } finally {
    if (prev === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prev;
  }
});

test("skills regex and strict canonical filter prevent non-canonical drift", () => {
  const text = "Built backend services in Python, C++, C#, .NET, Node.js, and psql.";
  const extracted = extractSkillsRegex(text);
  for (const expected of ["Python", "C++", "C#", "Node.js", "PostgreSQL"]) {
    assert.ok(extracted.includes(expected), `Expected ${expected} in ${extracted}`);
  }

  const normalized = deduplicateAndNormalize(
    ["postgres", "NonExistentBuzzword123", "k8s"],
    { strictCanonical: true }
  );
  assert.deepEqual(normalized, ["PostgreSQL", "Kubernetes"]);
});

test("gap engine computes net_ready_unlocked and updates readiness on simulation", () => {
  const jobs = [
    {
      job_id: "j1",
      title: "Backend Dev",
      company: "FinCorp",
      location: "Bengaluru",
      extracted_skills: ["Python", "PostgreSQL", "Docker", "Redis"],
    },
    {
      job_id: "j2",
      title: "Platform Dev",
      company: "CloudCo",
      location: "Bengaluru",
      extracted_skills: ["Python", "Docker", "Kubernetes", "AWS"],
    },
  ];
  const demandList = computeMarketDemand(jobs);
  const base = analyzeSkillGaps({
    role: "Backend Developer",
    location: "Bengaluru",
    userSkills: ["Python", "PostgreSQL"],
    jobs,
    demandList,
  });

  assert.equal(base.missing_gaps[0].skill, "Docker");
  assert.equal(base.missing_gaps[0].net_ready_unlocked, 1);
  assert.equal(base.ready_jobs.length, 0);

  const sim = analyzeSkillGaps({
    role: "Backend Developer",
    location: "Bengaluru",
    userSkills: ["Python", "PostgreSQL"],
    jobs,
    demandList,
    simulatedSkills: ["Docker"],
  });

  assert.ok(sim.readiness_score > base.readiness_score);
  assert.equal(sim.ready_jobs.length, 1);
  assert.equal(sim.ready_jobs[0].job_id, "j1");
});

test("jobs and courses parse YouTube + Google Search fallback and reject error payloads", async () => {
  const origDir = getCacheDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-serpapi-"));
  const prevKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-key";

  try {
    setCacheDir(tmpDir);

    await assert.rejects(
      fetchLiveJobs({
        role: "Test Role",
        location: "Bengaluru",
        useCache: false,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ error: "Invalid API key" }),
        }),
      }),
      /Invalid API key/
    );
    assert.equal(fs.readdirSync(tmpDir).length, 0);

    // Test YouTube empty -> Google Search organic_results fallback
    const fallbackResources = await fetchCoursesForSkill(
      "FastAPI",
      "Backend Developer",
      2,
      async (url) => {
        if (url.includes("engine=youtube")) {
          return { ok: true, json: async () => ({ video_results: [] }) };
        }
        return {
          ok: true,
          json: async () => ({
            organic_results: [
              {
                title: "FastAPI Official Tutorial",
                link: "https://fastapi.tiangolo.com/tutorial/",
                source: "FastAPI Docs",
              },
            ],
          }),
        };
      }
    );
    assert.equal(fallbackResources.length, 1);
    assert.equal(fallbackResources[0].source, "Google Search");
    assert.equal(fallbackResources[0].title, "FastAPI Official Tutorial");

    const gaps = [
      { skill: "Docker", jobs_unlocked: 5, demand_pct: 50, priority_rank: 1 },
      { skill: "Redis", jobs_unlocked: 3, demand_pct: 30, priority_rank: 2 },
    ];
    const enriched = await attachLearningResources(gaps, "Backend Engineer", 1, async () => ({
      ok: true,
      json: async () => ({
        video_results: [
          {
            title: "Docker Full Course",
            link: "https://youtube.com/watch?v=1",
            channel: { name: "TechChannel" },
            length: "2:15:00",
          },
        ],
      }),
    }));
    assert.equal(enriched[0].courses.length, 1);
    assert.ok(enriched[0].mini_project_idea.includes("Docker"));
    assert.equal(enriched[1].courses.length, 0);
    assert.ok(enriched[1].mini_project_idea.includes("Redis"));
  } finally {
    setCacheDir(origDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevKey;
  }
});

test("Career Toolkit: Multi-Role Fit, Local vs Remote, and ATS Bullets work offline", async () => {
  const prevSerp = process.env.SERPAPI_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.SERPAPI_KEY = "";
  process.env.GEMINI_API_KEY = "";

  try {
    const resumeText =
      "Backend developer experienced in Python, SQL, Flask, Django, PostgreSQL, Git, Linux, REST API.";
    const multi = await compareMultiRoleFit({
      resumeText,
      location: "Bengaluru, Karnataka, India",
      mode: "offline",
    });
    assert.equal(multi.evaluations.length, 3);
    assert.ok(multi.best_fit_role);

    const locRem = await compareLocalVsRemote({
      resumeText,
      role: "Backend Python Developer",
      localCity: "Bengaluru, Karnataka, India",
      mode: "offline",
    });
    assert.ok(locRem.local.readiness_score > 0);
    assert.equal(locRem.remote.location, "Remote");

    const bullets = await generateAtsBullets({
      resumeText,
      role: "Backend Python Developer",
      matchedSkills: ["Python", "PostgreSQL"],
      missingGaps: [{ skill: "Docker" }, { skill: "FastAPI" }],
    });
    assert.equal(bullets.length, 3);
  } finally {
    if (prevSerp === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevSerp;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});

test("resumeParser rejects empty PDF buffers and cleans text", async () => {
  assert.equal(cleanResumeText("  Python\u200b   SQL \r\n\r\n\r\n Git "), "Python SQL\n\nGit");
  await assert.rejects(extractTextFromPdfBuffer(Buffer.from("")), /Empty or unreadable PDF/);
});

test("HTTP server serves UI, 3 presets, analyze, on-demand courses, and toolkit APIs", async () => {
  const prevSerp = process.env.SERPAPI_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.SERPAPI_KEY = "";
  process.env.GEMINI_API_KEY = "";

  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.ok(health.canonicalSkills >= 60);

    const presetsRes = await fetch(`${baseUrl}/api/presets`);
    assert.equal(presetsRes.status, 200);
    const presetsBody = await presetsRes.json();
    assert.equal(presetsBody.presets.length, 3);

    const offlineRes = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "offline",
        role: presetsBody.presets[0].role,
        location: presetsBody.presets[0].city,
        resumeText: presetsBody.presets[0].text,
      }),
    });
    assert.equal(offlineRes.status, 200);
    const offlineJson = await offlineRes.json();
    assert.equal(offlineJson.analysisMode, "offline_demo");
    assert.equal(offlineJson.atsBullets.length, 3);

    const coursesRes = await fetch(`${baseUrl}/api/courses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "Docker", role: "Backend Developer" }),
    });
    assert.equal(coursesRes.status, 200);
    const coursesJson = await coursesRes.json();
    assert.ok(coursesJson.mini_project_idea.includes("Docker"));

    const toolkitRes = await fetch(`${baseUrl}/api/toolkit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "offline",
        role: presetsBody.presets[0].role,
        location: presetsBody.presets[0].city,
        resumeText: presetsBody.presets[0].text,
      }),
    });
    assert.equal(toolkitRes.status, 200);
    const toolkitJson = await toolkitRes.json();
    assert.equal(toolkitJson.multiRole.evaluations.length, 3);
    assert.equal(toolkitJson.localVsRemote.remote.location, "Remote");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevSerp === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevSerp;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});
