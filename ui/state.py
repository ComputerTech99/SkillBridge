"""Session state management, live analysis pipeline, and offline demo snapshot for SkillBridge UI."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import streamlit as st

from src.courses import _build_mini_project_idea, attach_learning_resources
from src.gap import analyze_skill_gaps
from src.jobs import fetch_live_jobs
from src.resume_parser import clean_resume_text
from src.schemas import AnalysisResult, GapItem, JobPosting, SkillDemand
from src.skills import (
    _extract_skills_regex,
    compute_market_demand,
    enrich_jobs_with_skills,
    extract_skills_from_text,
)

SAMPLE_RESUMES_PATH = Path(__file__).resolve().parent.parent / "data" / "sample_resumes.json"
CITY_OPTIONS = [
    "Bengaluru, Karnataka, India",
    "Mumbai, Maharashtra, India",
    "Remote",
]

_FALLBACK_PRESETS: list[dict[str, str]] = [
    {
        "label": "CS Final-Year Student (Frontend)",
        "role": "Frontend Developer",
        "city": CITY_OPTIONS[0],
        "text": (
            "Frontend developer with internship experience in JavaScript (ES6+), HTML5, CSS3, "
            "React.js, Tailwind CSS, Git, and REST APIs. Built responsive single-page apps."
        ),
    },
    {
        "label": "Junior Python Developer (Backend)",
        "role": "Backend Python Developer",
        "city": CITY_OPTIONS[0],
        "text": (
            "Backend developer experienced in Python 3, SQL, Flask, Django REST Framework, "
            "PostgreSQL, SQLite, Git, Linux, REST API, and Agile sprints."
        ),
    },
    {
        "label": "Aspiring Data Analyst",
        "role": "Data Analyst",
        "city": CITY_OPTIONS[0],
        "text": (
            "Economics and Data Science graduate skilled in Python, Pandas, NumPy, SQL, Excel, "
            "and Tableau. Completed capstone EDA and sales forecasting notebooks."
        ),
    },
]


def _normalize_presets(raw: Any) -> list[dict[str, str]]:
    """Normalize arbitrary JSON sample_resumes formats into {label, role, city, text}."""
    presets: list[dict[str, str]] = []
    if isinstance(raw, dict):
        for name, value in raw.items():
            if isinstance(value, str) and value.strip():
                presets.append(
                    {
                        "label": str(name),
                        "role": "Backend Python Developer",
                        "city": CITY_OPTIONS[0],
                        "text": value,
                    }
                )
            elif isinstance(value, dict):
                text = str(
                    value.get("resume_text")
                    or value.get("text")
                    or value.get("content")
                    or value.get("summary")
                    or ""
                )
                role = str(value.get("target_role") or value.get("role") or "Backend Python Developer")
                city = str(value.get("default_city") or value.get("city") or CITY_OPTIONS[0])
                if text.strip():
                    presets.append({"label": str(name), "role": role, "city": city, "text": text})
    elif isinstance(raw, list):
        for idx, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            label = str(
                item.get("name")
                or item.get("label")
                or item.get("title")
                or item.get("persona")
                or f"Sample Resume {idx + 1}"
            )
            text = str(
                item.get("resume_text")
                or item.get("text")
                or item.get("content")
                or item.get("summary")
                or ""
            )
            role = str(item.get("target_role") or item.get("role") or "Backend Python Developer")
            city = str(item.get("default_city") or item.get("city") or CITY_OPTIONS[0])
            if text.strip():
                presets.append({"label": label, "role": role, "city": city, "text": text})
    return presets


def load_sample_resumes() -> list[dict[str, str]]:
    """Load 1-click resume presets from data/sample_resumes.json with safe fallback."""
    if SAMPLE_RESUMES_PATH.is_file():
        try:
            raw = json.loads(SAMPLE_RESUMES_PATH.read_text(encoding="utf-8"))
            parsed = _normalize_presets(raw)
            if parsed:
                return parsed
        except (OSError, json.JSONDecodeError, ValueError):
            pass
    return [dict(item) for item in _FALLBACK_PRESETS]


def init_session_state() -> None:
    """Initialize all shared SkillBridge st.session_state keys once."""
    defaults: dict[str, Any] = {
        "jobs": [],
        "demand_list": [],
        "user_skills": [],
        "resume_text": "",
        "analysis_role": "",
        "analysis_location": "",
        "baseline_result": None,
        "courses_by_skill": {},
        "has_analyzed": False,
        "last_error": None,
        "analysis_mode": "live",
        "offline_demo_notice": "",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def clear_simulator_checkboxes() -> None:
    """Delete any What-If simulator checkbox keys so fresh runs start clean."""
    for key in list(st.session_state.keys()):
        if isinstance(key, str) and key.startswith("sim_skill_"):
            del st.session_state[key]


def _store_analysis_results(
    *,
    cleaned_resume: str,
    user_skills: list[str],
    jobs: list[JobPosting],
    demand_list: list[SkillDemand],
    role: str,
    location: str,
    baseline: AnalysisResult,
    courses_by_skill: dict[str, GapItem],
    analysis_mode: str,
    offline_demo_notice: str,
) -> None:
    """Persist computed pipeline outputs into st.session_state and reset simulator state."""
    st.session_state["resume_text"] = cleaned_resume
    st.session_state["user_skills"] = user_skills
    st.session_state["jobs"] = jobs
    st.session_state["demand_list"] = demand_list
    st.session_state["analysis_role"] = role
    st.session_state["analysis_location"] = location
    st.session_state["baseline_result"] = baseline
    st.session_state["courses_by_skill"] = courses_by_skill
    st.session_state["has_analyzed"] = True
    st.session_state["last_error"] = None
    st.session_state["analysis_mode"] = analysis_mode
    st.session_state["offline_demo_notice"] = offline_demo_notice
    clear_simulator_checkboxes()


def run_market_analysis(resume_text: str, role: str, location: str) -> None:
    """Execute the live/cached market pipeline and populate st.session_state."""
    cleaned_resume = clean_resume_text(resume_text)
    if not cleaned_resume:
        raise ValueError("Please upload a readable PDF resume or pick a sample preset.")

    user_skills = extract_skills_from_text(cleaned_resume)
    jobs = fetch_live_jobs(role=role, location=location, limit=10, use_cache=True)
    enriched_jobs = enrich_jobs_with_skills(jobs)
    demand_list = compute_market_demand(enriched_jobs)

    baseline = analyze_skill_gaps(
        role=role,
        location=location,
        user_skills=user_skills,
        jobs=enriched_jobs,
        demand_list=demand_list,
    )

    enriched_top_gaps = attach_learning_resources(baseline.missing_gaps, role=role, top_n=4)
    courses_by_skill = {gap.skill: gap for gap in enriched_top_gaps[:4]}

    _store_analysis_results(
        cleaned_resume=cleaned_resume,
        user_skills=user_skills,
        jobs=enriched_jobs,
        demand_list=demand_list,
        role=role,
        location=location,
        baseline=baseline,
        courses_by_skill=courses_by_skill,
        analysis_mode="live_or_cached",
        offline_demo_notice="",
    )


def _offline_frontend_specs(loc: str) -> list[dict[str, Any]]:
    """Deterministic job specs for Frontend Developer offline demo."""
    return [
        {
            "job_id": "demo-fe-1",
            "title": "Junior Frontend Developer (React)",
            "company": "FinStack Labs",
            "location": loc,
            "salary_text": "6 - 9 LPA",
            "skills": ["React", "JavaScript", "HTML", "CSS", "Tailwind CSS", "Git"],
            "description": (
                "Build responsive web interfaces using React, JavaScript, HTML5, CSS3, "
                "Tailwind CSS, and Git pull-request workflows."
            ),
        },
        {
            "job_id": "demo-fe-2",
            "title": "Frontend Engineer — Web Platform",
            "company": "PayPulse India",
            "location": loc,
            "salary_text": "8 - 12 LPA",
            "skills": ["React", "JavaScript", "HTML", "CSS", "REST API", "TypeScript"],
            "description": (
                "Develop dashboard modules with React, TypeScript, JavaScript, HTML, CSS, "
                "and REST API integrations."
            ),
        },
        {
            "job_id": "demo-fe-3",
            "title": "UI Developer (React & Next.js)",
            "company": "CartFlow Commerce",
            "location": loc,
            "salary_text": "9 - 14 LPA",
            "skills": ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Next.js", "Tailwind CSS"],
            "description": (
                "Ship fast storefront pages using React, Next.js, TypeScript, JavaScript, "
                "HTML, CSS, and Tailwind CSS."
            ),
        },
        {
            "job_id": "demo-fe-4",
            "title": "Frontend Product Engineer",
            "company": "CloudMetrics AI",
            "location": loc,
            "salary_text": "10 - 15 LPA",
            "skills": ["React", "TypeScript", "Next.js", "Tailwind CSS", "Jest", "Git"],
            "description": (
                "Own interactive analytics UIs in React, Next.js, TypeScript, and Tailwind CSS "
                "with unit testing in Jest and version control via Git."
            ),
        },
        {
            "job_id": "demo-fe-5",
            "title": "React Software Engineer",
            "company": "HealthGrid Digital",
            "location": loc,
            "salary_text": "8 - 13 LPA",
            "skills": ["React", "JavaScript", "TypeScript", "GraphQL", "Jest", "CSS"],
            "description": (
                "Implement patient portals with React, TypeScript, JavaScript, CSS, GraphQL "
                "queries, and automated Jest test suites."
            ),
        },
        {
            "job_id": "demo-fe-6",
            "title": "Full-Cycle Frontend Engineer",
            "company": "ScaleOps Tech",
            "location": "Remote",
            "salary_text": "12 - 18 LPA",
            "skills": ["React", "TypeScript", "Next.js", "GraphQL", "Docker", "CI/CD"],
            "description": (
                "Build SSR applications with React, Next.js, TypeScript, GraphQL, containerized "
                "via Docker with CI/CD pipelines."
            ),
        },
        {
            "job_id": "demo-fe-7",
            "title": "Frontend Automation & UI Engineer",
            "company": "VelocityPay",
            "location": loc,
            "salary_text": "10 - 16 LPA",
            "skills": ["React", "TypeScript", "Jest", "Playwright", "CI/CD", "AWS"],
            "description": (
                "Maintain checkout experiences in React and TypeScript backed by Jest, "
                "Playwright end-to-end tests, CI/CD, and AWS hosting."
            ),
        },
    ]


def _offline_backend_specs(loc: str) -> list[dict[str, Any]]:
    """Deterministic job specs for Backend Python Developer offline demo."""
    return [
        {
            "job_id": "demo-be-1",
            "title": "Backend Python Developer",
            "company": "FinLedger Tech",
            "location": loc,
            "salary_text": "7 - 11 LPA",
            "skills": ["Python", "Django", "PostgreSQL", "REST API", "Git", "Linux"],
            "description": (
                "Design scalable REST API services in Python and Django backed by PostgreSQL "
                "on Linux using Git code reviews."
            ),
        },
        {
            "job_id": "demo-be-2",
            "title": "Python API Engineer",
            "company": "LedgerFlow Systems",
            "location": loc,
            "salary_text": "8 - 12 LPA",
            "skills": ["Python", "Flask", "PostgreSQL", "SQL", "REST API", "Docker"],
            "description": (
                "Build reliable Flask REST API microservices in Python with SQL, PostgreSQL, "
                "and Docker containers."
            ),
        },
        {
            "job_id": "demo-be-3",
            "title": "Software Engineer — Python Backend",
            "company": "QuickShip Logistics",
            "location": loc,
            "salary_text": "10 - 15 LPA",
            "skills": ["Python", "FastAPI", "PostgreSQL", "Docker", "REST API", "Git"],
            "description": (
                "Develop high-throughput FastAPI REST API endpoints in Python with PostgreSQL, "
                "Docker, and Git."
            ),
        },
        {
            "job_id": "demo-be-4",
            "title": "Backend Engineer (Django & Caching)",
            "company": "RetailStack India",
            "location": loc,
            "salary_text": "9 - 14 LPA",
            "skills": ["Python", "Django", "PostgreSQL", "Docker", "Redis", "Pytest"],
            "description": (
                "Scale e-commerce backends using Python, Django, PostgreSQL, Redis caching, "
                "Docker, and Pytest integration tests."
            ),
        },
        {
            "job_id": "demo-be-5",
            "title": "Junior Platform Engineer (Python)",
            "company": "SignalCore Analytics",
            "location": "Remote",
            "salary_text": "9 - 13 LPA",
            "skills": ["Python", "FastAPI", "PostgreSQL", "Redis", "Docker", "Linux"],
            "description": (
                "Build low-latency FastAPI services in Python using PostgreSQL, Redis, Docker, "
                "and Linux deployments."
            ),
        },
        {
            "job_id": "demo-be-6",
            "title": "Cloud Backend Developer (Python)",
            "company": "NexaCloud Labs",
            "location": loc,
            "salary_text": "12 - 18 LPA",
            "skills": ["Python", "FastAPI", "Docker", "Kubernetes", "AWS", "CI/CD"],
            "description": (
                "Operate Python and FastAPI services packaged in Docker on Kubernetes and AWS "
                "with automated CI/CD workflows."
            ),
        },
        {
            "job_id": "demo-be-7",
            "title": "Senior-Track Python Engineer",
            "company": "CredPulse",
            "location": loc,
            "salary_text": "11 - 17 LPA",
            "skills": ["Python", "Django", "Docker", "Redis", "AWS", "Pytest", "CI/CD"],
            "description": (
                "Deliver resilient Python and Django services with Redis, Docker, AWS, Pytest "
                "coverage, and CI/CD automation."
            ),
        },
    ]


def _offline_data_analyst_specs(loc: str) -> list[dict[str, Any]]:
    """Deterministic job specs for Data Analyst offline demo."""
    return [
        {
            "job_id": "demo-da-1",
            "title": "Junior Data Analyst",
            "company": "MetricPulse Retail",
            "location": loc,
            "salary_text": "6 - 9 LPA",
            "skills": ["Python", "SQL", "Pandas", "Excel", "Tableau"],
            "description": (
                "Analyze business KPIs using SQL, Python, Pandas, Excel models, and Tableau "
                "executive dashboards."
            ),
        },
        {
            "job_id": "demo-da-2",
            "title": "Business & Product Analyst",
            "company": "FinServe Insights",
            "location": loc,
            "salary_text": "7 - 10 LPA",
            "skills": ["Python", "SQL", "Pandas", "NumPy", "Power BI"],
            "description": (
                "Explore funnel conversion cohorts with Python, Pandas, NumPy, SQL, and "
                "Power BI reporting."
            ),
        },
        {
            "job_id": "demo-da-3",
            "title": "BI & Revenue Data Analyst",
            "company": "ShopWave India",
            "location": loc,
            "salary_text": "8 - 12 LPA",
            "skills": ["SQL", "Python", "Tableau", "Power BI", "ETL"],
            "description": (
                "Maintain automated ETL reporting pipelines using SQL and Python feeding "
                "Tableau and Power BI dashboards."
            ),
        },
        {
            "job_id": "demo-da-4",
            "title": "Product Analytics Specialist",
            "company": "UrbanFleet",
            "location": loc,
            "salary_text": "8 - 13 LPA",
            "skills": ["Python", "SQL", "Pandas", "Power BI", "PostgreSQL", "Git"],
            "description": (
                "Write PostgreSQL and SQL queries, build Python Pandas notebooks, track code "
                "in Git, and publish Power BI scorecards."
            ),
        },
        {
            "job_id": "demo-da-5",
            "title": "Analytics Engineer / Analyst",
            "company": "DataNest Studio",
            "location": "Remote",
            "salary_text": "9 - 14 LPA",
            "skills": ["SQL", "Excel", "Tableau", "BigQuery", "ETL", "dbt"],
            "description": (
                "Transform warehouse tables in BigQuery with SQL, dbt, and ETL workflows for "
                "Tableau and Excel stakeholders."
            ),
        },
        {
            "job_id": "demo-da-6",
            "title": "Data Platform Analyst",
            "company": "StreamLine Media",
            "location": loc,
            "salary_text": "10 - 16 LPA",
            "skills": ["Python", "SQL", "Apache Spark", "ETL", "AWS", "Apache Airflow"],
            "description": (
                "Build large-scale ETL jobs in Python, SQL, and Apache Spark orchestrated by "
                "Apache Airflow on AWS."
            ),
        },
        {
            "job_id": "demo-da-7",
            "title": "Cloud BI Analyst",
            "company": "ScaleKart",
            "location": loc,
            "salary_text": "10 - 15 LPA",
            "skills": ["SQL", "Power BI", "Snowflake", "dbt", "Python", "AWS"],
            "description": (
                "Model Snowflake datasets with SQL, dbt, and Python to power AWS-backed "
                "Power BI reporting."
            ),
        },
    ]


def build_offline_demo_jobs(role: str, location: str) -> list[JobPosting]:
    """Build deterministic offline JobPosting fixtures tailored to the target role."""
    normalized_role = role.strip().lower()
    effective_location = location.strip() or CITY_OPTIONS[0]

    if any(token in normalized_role for token in ("front", "react", "ui", "web")):
        specs = _offline_frontend_specs(effective_location)
    elif any(token in normalized_role for token in ("data", "analyst", "analytics", "bi")):
        specs = _offline_data_analyst_specs(effective_location)
    else:
        specs = _offline_backend_specs(effective_location)

    postings: list[JobPosting] = []
    for spec in specs:
        skills: list[str] = list(spec["skills"])
        postings.append(
            JobPosting(
                job_id=spec["job_id"],
                title=spec["title"],
                company=spec["company"],
                location=spec["location"],
                salary_text=spec["salary_text"],
                qualifications=[f"Hands-on experience with {', '.join(skills)}."],
                description=spec["description"],
                apply_url=None,
                extracted_skills=skills,
            )
        )
    return postings


def _enrich_jobs_offline(jobs: list[JobPosting]) -> list[JobPosting]:
    """Populate JobPosting.extracted_skills using local regex extraction (0 API calls)."""
    for job in jobs:
        combined_text = "\n".join(
            part for part in [*job.qualifications, job.description] if part and part.strip()
        )
        extracted = _extract_skills_regex(combined_text)
        job.extracted_skills = extracted or list(job.extracted_skills)
    return jobs


def run_offline_demo_snapshot(resume_text: str, role: str, location: str) -> None:
    """Run the full analysis pipeline offline (0 SerpApi / 0 Gemini network calls)."""
    cleaned_resume = clean_resume_text(resume_text)
    if not cleaned_resume:
        raise ValueError("Please upload a readable PDF resume or pick a sample preset.")

    user_skills = _extract_skills_regex(cleaned_resume)
    demo_jobs = build_offline_demo_jobs(role=role, location=location)
    enriched_jobs = _enrich_jobs_offline(demo_jobs)
    demand_list = compute_market_demand(enriched_jobs)

    baseline = analyze_skill_gaps(
        role=role,
        location=location,
        user_skills=user_skills,
        jobs=enriched_jobs,
        demand_list=demand_list,
    )

    courses_by_skill: dict[str, GapItem] = {}
    for gap in baseline.missing_gaps[:4]:
        courses_by_skill[gap.skill] = gap.model_copy(
            update={
                "courses": [],
                "mini_project_idea": _build_mini_project_idea(gap.skill, role),
            }
        )

    _store_analysis_results(
        cleaned_resume=cleaned_resume,
        user_skills=user_skills,
        jobs=enriched_jobs,
        demand_list=demand_list,
        role=role,
        location=location,
        baseline=baseline,
        courses_by_skill=courses_by_skill,
        analysis_mode="offline_demo",
        offline_demo_notice=(
            f"Offline Demo Snapshot active for {role} in {location} — "
            "deterministic local dataset used (0 API credits consumed)."
        ),
    )
