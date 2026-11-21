/**
 * Shared ROI gap ranking, job readiness classification, and What-If simulation engine.
 * Pure ESM with zero Node/DOM dependencies so both server and browser share identical math.
 * Computes both total market demand (jobs_unlocked) and marginal net_ready_unlocked per gap.
 */

function computeJobCoverage(jobSkillsSet, effectiveSkillsSet) {
  if (jobSkillsSet.size === 0) {
    return { coverage: 0, missingCount: 0 };
  }
  let matchedCount = 0;
  for (const skill of jobSkillsSet) {
    if (effectiveSkillsSet.has(skill)) {
      matchedCount += 1;
    }
  }
  const missingCount = jobSkillsSet.size - matchedCount;
  return {
    coverage: matchedCount / jobSkillsSet.size,
    missingCount,
  };
}

function isJobReady(coverage, missingCount) {
  return coverage >= 0.75 || missingCount <= 1;
}

function countMarginalReadyUnlocks(jobs, effectiveSkillsSet, candidateSkill) {
  const augmented = new Set(effectiveSkillsSet);
  augmented.add(candidateSkill);
  let newlyReady = 0;

  for (const job of jobs || []) {
    const jobSkills = new Set(job.extracted_skills || []);
    if (jobSkills.size === 0 || !jobSkills.has(candidateSkill)) continue;

    const before = computeJobCoverage(jobSkills, effectiveSkillsSet);
    if (isJobReady(before.coverage, before.missingCount)) continue;

    const after = computeJobCoverage(jobSkills, augmented);
    if (isJobReady(after.coverage, after.missingCount)) {
      newlyReady += 1;
    }
  }
  return newlyReady;
}

function buildMissingGaps(demandList, effectiveSkillsSet, jobs) {
  const missingDemands = (demandList || []).filter(
    (d) => !effectiveSkillsSet.has(d.skill)
  );

  const scored = missingDemands.map((demand) => {
    const unlocked =
      Array.isArray(demand.unlocked_job_ids) && demand.unlocked_job_ids.length > 0
        ? demand.unlocked_job_ids.length
        : Number(demand.job_count || 0);
    const netReadyUnlocked = countMarginalReadyUnlocks(
      jobs,
      effectiveSkillsSet,
      demand.skill
    );
    return {
      skill: demand.skill,
      jobs_unlocked: unlocked,
      net_ready_unlocked: netReadyUnlocked,
      demand_pct: Math.round(Number(demand.demand_pct || 0) * 10) / 10,
    };
  });

  scored.sort((a, b) => {
    if (b.jobs_unlocked !== a.jobs_unlocked) return b.jobs_unlocked - a.jobs_unlocked;
    if (b.net_ready_unlocked !== a.net_ready_unlocked) {
      return b.net_ready_unlocked - a.net_ready_unlocked;
    }
    if (b.demand_pct !== a.demand_pct) return b.demand_pct - a.demand_pct;
    return a.skill.localeCompare(b.skill);
  });

  return scored.map((item, idx) => ({
    ...item,
    priority_rank: idx + 1,
    courses: [],
    mini_project_idea: "",
  }));
}

export function analyzeSkillGaps({
  role,
  location,
  userSkills = [],
  jobs = [],
  demandList = [],
  simulatedSkills = [],
}) {
  const effectiveSkills = new Set([...(userSkills || []), ...(simulatedSkills || [])]);

  const demandSkills = (demandList || []).map((d) => d.skill);
  const allJobSkills = new Set();
  for (const job of jobs || []) {
    for (const s of job.extracted_skills || []) {
      allJobSkills.add(s);
    }
  }

  const matchedSkills = demandSkills.filter((s) => effectiveSkills.has(s));
  const matchedSet = new Set(matchedSkills);
  const extraMatched = [...effectiveSkills]
    .filter((s) => allJobSkills.has(s) && !matchedSet.has(s))
    .sort();
  matchedSkills.push(...extraMatched);

  const missingGaps = buildMissingGaps(demandList, effectiveSkills, jobs);

  const readyCandidates = [];
  const almostCandidates = [];
  const coverages = [];

  (jobs || []).forEach((job, idx) => {
    const jobSkills = new Set(job.extracted_skills || []);
    if (jobSkills.size === 0) return;

    const { coverage, missingCount } = computeJobCoverage(jobSkills, effectiveSkills);
    coverages.push(coverage);

    if (isJobReady(coverage, missingCount)) {
      readyCandidates.push({ coverage, missingCount, idx, job });
    } else if (missingCount >= 2 && missingCount <= 3) {
      almostCandidates.push({ coverage, missingCount, idx, job });
    }
  });

  readyCandidates.sort(
    (a, b) =>
      b.coverage - a.coverage || a.missingCount - b.missingCount || a.idx - b.idx
  );
  almostCandidates.sort(
    (a, b) =>
      a.missingCount - b.missingCount || b.coverage - a.coverage || a.idx - b.idx
  );

  let rawScore = 0;
  if (coverages.length > 0) {
    rawScore = (coverages.reduce((sum, c) => sum + c, 0) / coverages.length) * 100;
  } else if (demandList && demandList.length > 0) {
    const totalWeight = demandList.reduce((sum, d) => sum + (d.job_count || 0), 0);
    const matchedWeight = demandList
      .filter((d) => effectiveSkills.has(d.skill))
      .reduce((sum, d) => sum + (d.job_count || 0), 0);
    rawScore = totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 0;
  }

  const readinessScore = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;

  return {
    role,
    location,
    readiness_score: readinessScore,
    matched_skills: matchedSkills,
    missing_gaps: missingGaps,
    ready_jobs: readyCandidates.map((item) => item.job),
    almost_ready_jobs: almostCandidates.map((item) => item.job),
  };
}
