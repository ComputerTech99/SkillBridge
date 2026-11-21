"""ROI gap ranking, job readiness classification, and What-If simulation engine."""

from __future__ import annotations

from src.schemas import AnalysisResult, GapItem, JobPosting, SkillDemand


def _job_coverage(job_skills: set[str], effective_skills: set[str]) -> tuple[float, int]:
    """Return (coverage_ratio, missing_count) for a single job's required skills."""
    if not job_skills:
        return 0.0, 0
    matched_count = len(job_skills & effective_skills)
    missing_count = len(job_skills) - matched_count
    return matched_count / len(job_skills), missing_count


def _build_missing_gaps(
    demand_list: list[SkillDemand],
    effective_skills: set[str],
) -> list[GapItem]:
    """Rank skills missing from effective_skills by jobs_unlocked descending."""
    missing_demands = [d for d in demand_list if d.skill not in effective_skills]
    scored: list[tuple[int, float, str, SkillDemand]] = []
    for demand in missing_demands:
        unlocked = (
            len(demand.unlocked_job_ids)
            if demand.unlocked_job_ids
            else demand.job_count
        )
        scored.append((unlocked, demand.demand_pct, demand.skill, demand))

    scored.sort(key=lambda item: (-item[0], -item[1], item[2]))

    return [
        GapItem(
            skill=demand.skill,
            jobs_unlocked=unlocked,
            demand_pct=round(demand_pct, 1),
            priority_rank=rank,
        )
        for rank, (unlocked, demand_pct, _, demand) in enumerate(scored, start=1)
    ]


def analyze_skill_gaps(
    role: str,
    location: str,
    user_skills: list[str],
    jobs: list[JobPosting],
    demand_list: list[SkillDemand],
    simulated_skills: list[str] | None = None,
) -> AnalysisResult:
    """Compute readiness score, ranked missing gaps, and job buckets for a candidate."""
    effective_skills = set(user_skills) | set(simulated_skills or [])

    demand_skills = [d.skill for d in demand_list]
    all_job_skills = {skill for job in jobs for skill in job.extracted_skills}
    matched_skills = [s for s in demand_skills if s in effective_skills]
    matched_set = set(matched_skills)
    for extra in sorted((effective_skills & all_job_skills) - matched_set):
        matched_skills.append(extra)

    missing_gaps = _build_missing_gaps(demand_list, effective_skills)

    ready_candidates: list[tuple[float, int, int, JobPosting]] = []
    almost_candidates: list[tuple[int, float, int, JobPosting]] = []
    coverages: list[float] = []

    for idx, job in enumerate(jobs):
        job_skills = set(job.extracted_skills)
        if not job_skills:
            continue

        coverage, missing_count = _job_coverage(job_skills, effective_skills)
        coverages.append(coverage)

        if coverage >= 0.75 or missing_count <= 1:
            ready_candidates.append((-coverage, missing_count, idx, job))
        elif 2 <= missing_count <= 3:
            almost_candidates.append((missing_count, -coverage, idx, job))

    ready_candidates.sort(key=lambda item: (item[0], item[1], item[2]))
    almost_candidates.sort(key=lambda item: (item[0], item[1], item[2]))

    ready_jobs = [item[3] for item in ready_candidates]
    almost_ready_jobs = [item[3] for item in almost_candidates]

    if coverages:
        raw_score = (sum(coverages) / len(coverages)) * 100.0
    elif demand_list:
        total_weight = sum(d.job_count for d in demand_list)
        matched_weight = sum(
            d.job_count for d in demand_list if d.skill in effective_skills
        )
        raw_score = (matched_weight / total_weight) * 100.0 if total_weight > 0 else 0.0
    else:
        raw_score = 0.0

    readiness_score = round(max(0.0, min(100.0, raw_score)), 1)

    return AnalysisResult(
        role=role,
        location=location,
        readiness_score=readiness_score,
        matched_skills=matched_skills,
        missing_gaps=missing_gaps,
        ready_jobs=ready_jobs,
        almost_ready_jobs=almost_ready_jobs,
    )
