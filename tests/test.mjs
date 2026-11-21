import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getCacheDir, getCached, setCacheDir, setCached } from "../lib/cache.js";
import { attachLearningResources } from "../lib/courses.js";
import { fetchLiveJobs } from "../lib/jobs.js";
import { runOfflineDemoAnalysis } from "../lib/offlineDemo.js";
import { cleanResumeText, extractTextFromPdfBuffer } from "../lib/resumeParser.js";
import { computeMarketDemand, extractSkillsRegex } from "../lib/skills.js";
import { analyzeSkillGaps } from "../public/js/gap.js";
import { createAppServer } from "../server.js";

test("cache stores, retrieves, excludes api_key, and handles corrupted JSON", () => {
  const origDir = getCacheDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-cache-"));
  try {
    setCacheDir(tmpDir);
    assert.equal(getCached("google_jobs", { q: "backend", api_key: "k1" }), null);

    setCached("google_jobs", { location: "Bengaluru", q: "backend", api_key: "k1" }, { ok: 1 });
    const hit = getCached("google_jobs", { q: "backend", location: "Bengaluru", api_key: "k2" });
    assert.deepEqual(hit, { ok: 1 });

    // Corrupt a file and ensure graceful null return
    const files = fs.readdirSync(tmpDir);
    assert.equal(files.length, 1);
    fs.writeFileSync(path.join(tmpDir, files[0]), "{not-valid-json", "utf8");
    assert.equal(getCached("google_jobs", { q: "backend", location: "Bengaluru" }), null);
  } finally {
    setCacheDir(origDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("skills regex handles aliases and symbol-heavy skills cleanly", () => {
  const text = "Built backend services in Python, C++, C#, .NET, Node.js, and psql.";
  const extracted = extractSkillsRegex(text);
  for (const expected of ["Python", "C++", "C#", "Node.js", "PostgreSQL"]) {
    assert.ok(extracted.includes(expected), `Expected ${expected} in ${extracted}`);
  }
});

test("gap engine ranks missing skills and updates readiness + ready jobs on simulation", () => {
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
  assert.equal(base.missing_gaps[0].priority_rank, 1);
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

test("jobs and courses parse mocked SerpApi responses and never cache error payloads", async () => {
  const origDir = getCacheDir();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-serpapi-"));
  const prevKey = process.env.SERPAPI_KEY;
  process.env.SERPAPI_KEY = "test-key";

  try {
    setCacheDir(tmpDir);

    // Error payload must reject and leave cache empty
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

    // Valid jobs payload parses qualifications, salary, and apply_url
    const jobsPayload = {
      jobs_results: [
        {
          job_id: "job-1",
          title: "Backend Engineer",
          company_name: "Acme",
          location: "Bengaluru",
          description: "Python + Docker",
          detected_extensions: { salary: "12L - 18L" },
          job_highlights: [{ title: "Qualifications", items: ["Python", "Docker"] }],
          apply_options: [{ title: "LinkedIn", link: "https://example.com/apply/1" }],
        },
      ],
    };

    let jobFetchCalls = 0;
    const jobs1 = await fetchLiveJobs({
      role: "Backend Engineer",
      location: "Bengaluru",
      fetchImpl: async () => {
        jobFetchCalls += 1;
        return { ok: true, json: async () => jobsPayload };
      },
    });
    assert.equal(jobs1.length, 1);
    assert.equal(jobs1[0].salary_text, "12L - 18L");
    assert.deepEqual(jobs1[0].qualifications, ["Python", "Docker"]);
    assert.equal(jobs1[0].apply_url, "https://example.com/apply/1");

    // Second call uses cache (0 extra fetches)
    const jobs2 = await fetchLiveJobs({
      role: "Backend Engineer",
      location: "Bengaluru",
      fetchImpl: async () => {
        jobFetchCalls += 1;
        return { ok: true, json: async () => jobsPayload };
      },
    });
    assert.equal(jobFetchCalls, 1);
    assert.equal(jobs2.length, 1);

    // Courses caps at topN and parses YouTube results
    let ytCalls = 0;
    const gaps = [
      { skill: "Docker", jobs_unlocked: 5, demand_pct: 50, priority_rank: 1 },
      { skill: "Redis", jobs_unlocked: 3, demand_pct: 30, priority_rank: 2 },
    ];
    const enriched = await attachLearningResources(gaps, "Backend Engineer", 1, async () => {
      ytCalls += 1;
      return {
        ok: true,
        json: async () => ({
          video_results: [
            {
              title: "Docker Full Course",
              link: "https://youtube.com/watch?v=1",
              channel: { name: "TechChannel" },
              length: "2:15:00",
              thumbnail: { static: "https://img.youtube.com/1.jpg" },
            },
          ],
        }),
      };
    });
    assert.equal(ytCalls, 1);
    assert.equal(enriched[0].courses.length, 1);
    assert.ok(enriched[0].mini_project_idea.includes("Docker"));
    assert.equal(enriched[1].courses.length, 0);
  } finally {
    setCacheDir(origDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevKey;
  }
});

test("resumeParser rejects empty PDF buffers and cleans text", async () => {
  assert.equal(cleanResumeText("  Python\u200b   SQL \r\n\r\n\r\n Git "), "Python SQL\n\nGit");
  await assert.rejects(extractTextFromPdfBuffer(Buffer.from("")), /Empty or unreadable PDF/);
});

test("offlineDemo produces deterministic results with 0 external calls", () => {
  const result = runOfflineDemoAnalysis({
    resumeText: "Experienced with Python, Flask, PostgreSQL, SQL, Git, REST API.",
    role: "Backend Python Developer",
    location: "Bengaluru, Karnataka, India",
  });
  assert.equal(result.analysisMode, "offline_demo");
  assert.equal(result.jobs.length, 7);
  assert.ok(result.baseline.readiness_score > 0);
  assert.ok(result.baseline.missing_gaps.length > 0);
});

test("HTTP server serves static UI, presets, offline analyze, and seeded cache", async () => {
  const prevSerp = process.env.SERPAPI_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  process.env.SERPAPI_KEY = "";
  process.env.GEMINI_API_KEY = "";

  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes("SkillBridge"));

    const presetsRes = await fetch(`${baseUrl}/api/presets`);
    assert.equal(presetsRes.status, 200);
    const presetsBody = await presetsRes.json();
    assert.ok(Array.isArray(presetsBody.presets) && presetsBody.presets.length >= 2);

    // Offline analyze endpoint
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
    assert.ok(offlineJson.jobs.length > 0);

    // Seeded cache quick-demo check (runs cached live data with 0 keys if cache exists)
    if (fs.existsSync("data/cache") && fs.readdirSync("data/cache").length > 0) {
      const quickRes = await fetch(`${baseUrl}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "quick",
          role: "Frontend Developer",
          location: "Bengaluru, Karnataka, India",
          resumeText: presetsBody.presets[0].text,
        }),
      });
      assert.equal(quickRes.status, 200);
      const quickJson = await quickRes.json();
      assert.equal(quickJson.analysisMode, "live_or_cached");
      assert.ok(quickJson.jobs.length > 0);
    }

    // Missing target role returns 400 cleanly
    const badRes = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "offline", role: "", resumeText: "Python Developer" }),
    });
    assert.equal(badRes.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prevSerp === undefined) delete process.env.SERPAPI_KEY;
    else process.env.SERPAPI_KEY = prevSerp;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  }
});
