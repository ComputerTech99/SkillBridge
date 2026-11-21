"""Live job market fetcher and parser backed by SerpApi google_jobs and disk cache."""

from __future__ import annotations

import os
from typing import Any

import requests
from dotenv import load_dotenv

from src.cache import get_cached, set_cached
from src.schemas import JobPosting

SERPAPI_SEARCH_URL = "https://serpapi.com/search.json"
CACHE_NAMESPACE = "google_jobs"


def _extract_qualifications(raw_job: dict[str, Any]) -> list[str]:
    """Extract bullet items from job_highlights where title == 'Qualifications'."""
    highlights = raw_job.get("job_highlights") or []
    qualifications: list[str] = []
    for section in highlights:
        if not isinstance(section, dict):
            continue
        if section.get("title") == "Qualifications":
            items = section.get("items") or []
            qualifications.extend(str(item) for item in items if item)
    return qualifications


def _extract_apply_url(raw_job: dict[str, Any]) -> str | None:
    """Return the first valid link from apply_options, if present."""
    apply_options = raw_job.get("apply_options") or []
    for option in apply_options:
        if isinstance(option, dict):
            link = option.get("link")
            if link:
                return str(link)
    return None


def _parse_job_posting(raw_job: dict[str, Any], index: int, default_location: str) -> JobPosting:
    """Convert a single raw SerpApi google_jobs entry into a JobPosting model."""
    detected_extensions = raw_job.get("detected_extensions")
    salary_text: str | None = None
    if isinstance(detected_extensions, dict):
        raw_salary = detected_extensions.get("salary")
        if raw_salary is not None:
            salary_text = str(raw_salary)

    title = str(raw_job.get("title") or "")
    company = str(raw_job.get("company_name") or "")
    job_id = str(raw_job.get("job_id") or f"job-{index}-{company}-{title}")

    return JobPosting(
        job_id=job_id,
        title=title,
        company=company,
        location=str(raw_job.get("location") or default_location),
        salary_text=salary_text,
        qualifications=_extract_qualifications(raw_job),
        description=str(raw_job.get("description") or ""),
        apply_url=_extract_apply_url(raw_job),
    )


def fetch_live_jobs(
    role: str,
    location: str,
    limit: int = 10,
    use_cache: bool = True,
) -> list[JobPosting]:
    """Fetch live Google Jobs postings via SerpApi (with disk cache) and parse into JobPostings."""
    if limit <= 0:
        return []

    load_dotenv()

    search_params: dict[str, Any] = {
        "engine": "google_jobs",
        "q": role,
        "location": location,
        "gl": "in",
        "hl": "en",
    }

    payload: dict[str, Any] | None = (
        get_cached(CACHE_NAMESPACE, search_params) if use_cache else None
    )

    if payload is None:
        api_key = os.getenv("SERPAPI_KEY", "").strip()
        if not api_key:
            raise ValueError("SERPAPI_KEY is missing. Set it in your environment or .env file.")

        request_params = {**search_params, "api_key": api_key}
        response = requests.get(SERPAPI_SEARCH_URL, params=request_params, timeout=20)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            return []
        if "error" in payload:
            raise ValueError(f"SerpApi error: {payload['error']}")
        set_cached(CACHE_NAMESPACE, search_params, payload)

    raw_jobs = payload.get("jobs_results") or []
    postings: list[JobPosting] = []
    for idx, raw_job in enumerate(raw_jobs[:limit]):
        if isinstance(raw_job, dict):
            postings.append(_parse_job_posting(raw_job, idx, location))
    return postings
