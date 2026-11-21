/**
 * Career Toolkit engines for .md Stretch Goals:
 * 1. Multi-Role Fit Comparison (scores same resume across 3 adjacent roles)
 * 2. Local City vs. Remote Market Comparison
 * 3. ATS Resume Bullet Rewriter tailored to scraped market keywords
 */

import { getCached, setCached } from "./cache.js";
import { loadEnv } from "./env.js";
import { fetchLiveJobs, hasCachedJobsForQuery } from "./jobs.js";
import { buildOfflineDemoJobs } from "./offlineDemo.js";
import {
  computeMarketDemand,
  enrichJobsWithSkills,
  extractSkillsFromText,
  extractSkillsRegex,
} from "./skills.js";
import { analyzeSkillGaps } from "../public/js/gap.js";

const DEFAULT_COMPARISON_ROLES = [
  "Frontend Developer",
  "Backend Python Developer",
  "Data Analyst",
];

async function getJobsForRoleAndLocation({
  role,
  location,
  mode = "quick",
  fetchImpl = fetch,
}) {
  if (mode === "offline") {
    return buildOfflineDemoJobs(role, location);
  }
  const canUseLiveOrCache =
    Boolean((process.env.SERPAPI_KEY || "").trim()) ||
    hasCachedJobsForQuery(role, location);
  if (!canUseLiveOrCache) {
    return buildOfflineDemoJobs(role, location);
  }
  try {
    const rawJobs = await fetchLiveJobs({
      role,
      location,
      limit: 10,
      useCache: true,
      fetchImpl,
    });
    return await enrichJobsWithSkills(rawJobs, fetchImpl);
  } catch {
    return buildOfflineDemoJobs(role, location);
  }
}

export async function compareMultiRoleFit({
  resumeText,
  location,
  roles = DEFAULT_COMPARISON_ROLES,
  mode = "quick",
  fetchImpl = fetch,
}) {
  const userSkills =
    mode === "offline"
      ? extractSkillsRegex(resumeText)
      : await extractSkillsFromText(resumeText, fetchImpl);

  const uniqueRoles = [...new Set(roles.map((r) => String(r).trim()).filter(Boolean))];
  const evaluations = await Promise.all(
    uniqueRoles.map(async (targetRole) => {
      const jobs = await getJobsForRoleAndLocation({
        role: targetRole,
        location,
        mode,
        fetchImpl,
      });
      const demandList = computeMarketDemand(jobs);
      const analysis = analyzeSkillGaps({
        role: targetRole,
        location,
        userSkills,
        jobs,
        demandList,
      });
      return {
        role: targetRole,
        location,
        readiness_score: analysis.readiness_score,
        jobs_scanned: jobs.length,
        ready_jobs_count: analysis.ready_jobs.length,
        almost_ready_count: analysis.almost_ready_jobs.length,
        matched_skills: analysis.matched_skills,
        top_gaps: analysis.missing_gaps.slice(0, 3).map((g) => ({
          skill: g.skill,
          jobs_unlocked: g.jobs_unlocked,
          demand_pct: g.demand_pct,
        })),
      };
    })
  );

  evaluations.sort((a, b) => b.readiness_score - a.readiness_score);
  const bestFit = evaluations[0] || null;

  return {
    best_fit_role: bestFit ? bestFit.role : null,
    best_fit_score: bestFit ? bestFit.readiness_score : 0,
    evaluations,
  };
}

export async function compareLocalVsRemote({
  resumeText,
  role,
  localCity,
  mode = "quick",
  fetchImpl = fetch,
}) {
  const remoteLabel = "Remote";
  const effectiveLocal =
    localCity && localCity !== remoteLabel
      ? localCity
      : "Bengaluru, Karnataka, India";

  const userSkills =
    mode === "offline"
      ? extractSkillsRegex(resumeText)
      : await extractSkillsFromText(resumeText, fetchImpl);

  const [localJobs, remoteJobs] = await Promise.all([
    getJobsForRoleAndLocation({
      role,
      location: effectiveLocal,
      mode,
      fetchImpl,
    }),
    getJobsForRoleAndLocation({
      role,
      location: remoteLabel,
      mode: mode === "offline" ? "offline" : "quick",
      fetchImpl,
    }),
  ]);

  const localDemand = computeMarketDemand(localJobs);
  const remoteDemand = computeMarketDemand(remoteJobs);

  const localAnalysis = analyzeSkillGaps({
    role,
    location: effectiveLocal,
    userSkills,
    jobs: localJobs,
    demandList: localDemand,
  });
  const remoteAnalysis = analyzeSkillGaps({
    role,
    location: remoteLabel,
    userSkills,
    jobs: remoteJobs,
    demandList: remoteDemand,
  });

  return {
    local: {
      location: effectiveLocal,
      readiness_score: localAnalysis.readiness_score,
      ready_jobs_count: localAnalysis.ready_jobs.length,
      top_skills: localDemand.slice(0, 5),
      top_gap: localAnalysis.missing_gaps[0]?.skill || "All Covered",
    },
    remote: {
      location: remoteLabel,
      readiness_score: remoteAnalysis.readiness_score,
      ready_jobs_count: remoteAnalysis.ready_jobs.length,
      top_skills: remoteDemand.slice(0, 5),
      top_gap: remoteAnalysis.missing_gaps[0]?.skill || "All Covered",
    },
  };
}

export async function generateAtsBullets({
  resumeText,
  role,
  matchedSkills = [],
  missingGaps = [],
  fetchImpl = fetch,
}) {
  loadEnv();
  const topMatched = matchedSkills.slice(0, 4);
  const topMissing = missingGaps.slice(0, 3).map((g) => g.skill || String(g));
  const coreSkills = topMatched.length > 0 ? topMatched : ["Python", "SQL", "Git"];
  const targetKeywords = [...coreSkills, ...topMissing].slice(0, 6);

  const cacheParams = {
    role,
    matched: coreSkills,
    missing: topMissing,
    resumeSnippet: (resumeText || "").slice(0, 400),
  };

  const cached = getCached("gemini_ats_bullets", cacheParams);
  if (cached && Array.isArray(cached.bullets) && cached.bullets.length >= 2) {
    return cached.bullets;
  }

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (apiKey) {
    try {
      const prompt =
        `Write 3 concise, high-impact ATS resume bullet points for a candidate targeting "${role}".\n` +
        `Incorporate these verified candidate skills: [${coreSkills.join(", ")}] and weave in ` +
        `high-demand market keywords where natural: [${topMissing.join(", ")}].\n` +
        `Start each bullet with a strong action verb and include measurable impact metrics.\n` +
        `Return ONLY a JSON array of 3 strings.\n\n` +
        `Candidate Resume Context:\n${(resumeText || "").slice(0, 800)}`;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
          },
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          const bullets = parsed.slice(0, 3).map((b) => String(b).trim());
          setCached("gemini_ats_bullets", cacheParams, { bullets });
          return bullets;
        }
      }
    } catch {
      // Fallback to deterministic STAR bullets
    }
  }

  const s1 = coreSkills[0] || "Python";
  const s2 = coreSkills[1] || coreSkills[0] || "SQL";
  const g1 = topMissing[0] || "Docker";
  const g2 = topMissing[1] || topMissing[0] || "CI/CD";

  return [
    `Engineered and deployed production-grade ${role} modules using ${s1} and ${s2}, improving request reliability and cutting average execution latency by 32%.`,
    `Architected automated ${g1} and ${g2} workflows integrated with ${s1}, accelerating release validation and reducing manual deployment overhead by 40%.`,
    `Collaborated across cross-functional sprints to deliver scalable ${ targetKeywords.slice(0, 3).join(", ") } features backed by automated testing and clean documentation.`,
  ];
}
