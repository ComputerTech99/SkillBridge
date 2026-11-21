"""Offline end-to-end smoke tests for the SkillBridge backend pipeline."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.courses import attach_learning_resources
from src.gap import analyze_skill_gaps
from src.resume_parser import clean_resume_text
from src.schemas import AnalysisResult, JobPosting, SkillDemand
from src.skills import (
    compute_market_demand,
    enrich_jobs_with_skills,
    extract_skills_from_text,
)


def _offline_env() -> dict[str, str]:
    """Ensure API keys are blanked so tests never consume external API credits."""
    return {"GEMINI_API_KEY": "", "SERPAPI_KEY": ""}


def _build_mock_backend_jobs() -> list[JobPosting]:
    """Create deterministic mocked JobPosting fixtures for offline pipeline testing."""
    return [
        JobPosting(
            job_id="mock-job-1",
            title="Backend Python Developer",
            company="CloudScale India",
            location="Bengaluru, Karnataka, India",
            salary_text="12-18 LPA",
            qualifications=[
                "Strong experience in Python and FastAPI",
                "Hands-on PostgreSQL and Docker experience",
            ],
            description="Build containerized microservices with REST APIs, Redis caching, and CI/CD.",
            apply_url="https://example.com/jobs/1",
        ),
        JobPosting(
            job_id="mock-job-2",
            title="Python Software Engineer",
            company="DataPulse Labs",
            location="Bengaluru, Karnataka, India",
            salary_text="10-15 LPA",
            qualifications=[
                "Proficiency in Python, Django, and PostgreSQL",
                "Familiarity with Docker and AWS",
            ],
            description="Design scalable backend services with automated Pytest suites and Git.",
            apply_url="https://example.com/jobs/2",
        ),
        JobPosting(
            job_id="mock-job-3",
            title="API Engineer (Python)",
            company="FinStack Solutions",
            location="Bengaluru, Karnataka, India",
            qualifications=[
                "Experience with Python, FastAPI, and SQL",
                "Containerization using Docker and Kubernetes",
            ],
            description="Own backend APIs deployed on Linux with GitHub Actions CI/CD.",
            apply_url="https://example.com/jobs/3",
        ),
        JobPosting(
            job_id="mock-job-4",
            title="Junior Python Engineer",
            company="BrightCart",
            location="Bengaluru, Karnataka, India",
            qualifications=[
                "Solid Python and Flask fundamentals",
                "Understanding of SQL and REST APIs",
            ],
            description="Work in an Agile team using Git and PostgreSQL.",
            apply_url="https://example.com/jobs/4",
        ),
    ]


def test_sample_resumes_fixture() -> None:
    """Verify data/sample_resumes.json exists and matches the expected persona schema."""
    fixture_path = PROJECT_ROOT / "data" / "sample_resumes.json"
    assert fixture_path.is_file(), "data/sample_resumes.json must exist"

    personas = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert isinstance(personas, list) and len(personas) == 2

    names = [p["name"] for p in personas]
    assert names == [
        "CS Final-Year Student (Frontend)",
        "Junior Python Developer (Backend)",
    ]

    for persona in personas:
        assert set(persona.keys()) >= {"name", "target_role", "default_city", "resume_text"}
        assert persona["default_city"] == "Bengaluru, Karnataka, India"
        assert len(clean_resume_text(persona["resume_text"])) >= 100


def test_backend_pipeline_offline_and_simulation() -> None:
    """Test extract_skills_from_text -> enrich -> demand -> gap -> simulated toggle."""
    fixture_path = PROJECT_ROOT / "data" / "sample_resumes.json"
    personas = json.loads(fixture_path.read_text(encoding="utf-8"))
    backend_persona = next(
        p for p in personas if p["name"] == "Junior Python Developer (Backend)"
    )

    with (
        patch.dict(os.environ, _offline_env(), clear=False),
        patch("src.skills.genai.Client", side_effect=AssertionError("LLM must not be called offline")),
        patch("src.courses.requests.get", side_effect=AssertionError("HTTP must not be called offline")),
        patch("src.courses.get_cached", return_value=None),
    ):
        # 1. Extract skills from candidate resume
        user_skills = extract_skills_from_text(clean_resume_text(backend_persona["resume_text"]))
        for expected in ("Python", "Flask", "Django", "PostgreSQL", "Git", "REST API"):
            assert expected in user_skills, f"Expected {expected} in {user_skills}"

        # 2. Enrich mocked job postings with extracted skills
        jobs = _build_mock_backend_jobs()
        enriched_jobs = enrich_jobs_with_skills(jobs)
        assert len(enriched_jobs) == 4
        assert all(len(job.extracted_skills) > 0 for job in enriched_jobs)
        assert "Docker" in enriched_jobs[0].extracted_skills
        assert "FastAPI" in enriched_jobs[0].extracted_skills

        # 3. Compute market demand sorted descending by job_count
        demand_list = compute_market_demand(enriched_jobs)
        assert len(demand_list) > 0
        assert all(isinstance(d, SkillDemand) for d in demand_list)
        assert [d.job_count for d in demand_list] == sorted(
            (d.job_count for d in demand_list), reverse=True
        )
        python_demand = next(d for d in demand_list if d.skill == "Python")
        assert python_demand.job_count == 4
        assert python_demand.total_jobs == 4
        assert python_demand.demand_pct == 100.0

        # 4. Baseline skill gap analysis
        baseline: AnalysisResult = analyze_skill_gaps(
            role=backend_persona["target_role"],
            location=backend_persona["default_city"],
            user_skills=user_skills,
            jobs=enriched_jobs,
            demand_list=demand_list,
        )
        assert isinstance(baseline, AnalysisResult)
        assert 0.0 < baseline.readiness_score < 100.0
        missing_skill_names = [g.skill for g in baseline.missing_gaps]
        assert "Docker" in missing_skill_names
        assert [g.priority_rank for g in baseline.missing_gaps] == list(
            range(1, len(baseline.missing_gaps) + 1)
        )

        # Attach offline mini-project ideas to top gaps without network calls
        enriched_gaps = attach_learning_resources(
            baseline.missing_gaps, role=backend_persona["target_role"], top_n=2
        )
        assert len(enriched_gaps[0].mini_project_idea) > 20
        assert enriched_gaps[0].courses == []

        # 5. Simulated What-If skill toggle (add top missing skills)
        simulated_toggle = [g.skill for g in baseline.missing_gaps[:2]]
        simulated: AnalysisResult = analyze_skill_gaps(
            role=backend_persona["target_role"],
            location=backend_persona["default_city"],
            user_skills=user_skills,
            jobs=enriched_jobs,
            demand_list=demand_list,
            simulated_skills=simulated_toggle,
        )
        assert simulated.readiness_score > baseline.readiness_score
        assert len(simulated.missing_gaps) == len(baseline.missing_gaps) - len(simulated_toggle)
        assert len(simulated.ready_jobs) >= len(baseline.ready_jobs)
        for toggled in simulated_toggle:
            assert toggled in simulated.matched_skills
            assert all(g.skill != toggled for g in simulated.missing_gaps)


def test_frontend_persona_extraction_offline() -> None:
    """Verify the Frontend persona extracts expected frontend skills offline."""
    fixture_path = PROJECT_ROOT / "data" / "sample_resumes.json"
    personas = json.loads(fixture_path.read_text(encoding="utf-8"))
    frontend_persona = next(
        p for p in personas if p["name"] == "CS Final-Year Student (Frontend)"
    )

    with patch.dict(os.environ, _offline_env(), clear=False):
        skills = extract_skills_from_text(frontend_persona["resume_text"])
        for expected in ("JavaScript", "HTML", "CSS", "React", "Tailwind CSS", "Git"):
            assert expected in skills, f"Expected {expected} in {skills}"


if __name__ == "__main__":
    test_sample_resumes_fixture()
    test_frontend_persona_extraction_offline()
    test_backend_pipeline_offline_and_simulation()
    print("ALL BACKEND SMOKE TESTS PASSED (0 API credits used)")
