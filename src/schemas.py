"""Strict Pydantic v2 data contracts shared across all SkillBridge backend modules."""

from __future__ import annotations

from pydantic import BaseModel, Field


class JobPosting(BaseModel):
    """Normalized representation of a single live job posting."""

    job_id: str
    title: str
    company: str
    location: str
    salary_text: str | None = None
    qualifications: list[str]
    description: str
    apply_url: str | None = None
    extracted_skills: list[str] = Field(default_factory=list)


class SkillDemand(BaseModel):
    """Aggregated market demand metrics for a single canonical skill."""

    skill: str
    job_count: int
    total_jobs: int
    demand_pct: float
    unlocked_job_ids: list[str]


class CourseResource(BaseModel):
    """Learning resource (video, course, or article) mapped to a skill gap."""

    title: str
    url: str
    source: str
    channel_or_site: str
    duration: str | None = None
    thumbnail: str | None = None


class GapItem(BaseModel):
    """Ranked missing skill along with ROI impact and learning recommendations."""

    skill: str
    jobs_unlocked: int
    demand_pct: float
    priority_rank: int
    courses: list[CourseResource] = Field(default_factory=list)
    mini_project_idea: str = ""


class AnalysisResult(BaseModel):
    """End-to-end SkillBridge gap analysis output for a target role and location."""

    role: str
    location: str
    readiness_score: float
    matched_skills: list[str]
    missing_gaps: list[GapItem]
    ready_jobs: list[JobPosting]
    almost_ready_jobs: list[JobPosting]
