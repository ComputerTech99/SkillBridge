"""Learning resource fetcher (SerpApi YouTube) and weekend mini-project generator."""

from __future__ import annotations

import os
from typing import Any

import requests
from dotenv import load_dotenv

from src.cache import get_cached, set_cached
from src.schemas import CourseResource, GapItem

SERPAPI_SEARCH_URL = "https://serpapi.com/search.json"
CACHE_NAMESPACE = "youtube"


def _extract_course_resource(item: dict[str, Any]) -> CourseResource | None:
    """Parse a raw SerpApi YouTube video or playlist item into CourseResource."""
    title = str(item.get("title") or "").strip()
    link = str(item.get("link") or "").strip()
    if not title or not link:
        return None

    raw_channel = item.get("channel")
    if isinstance(raw_channel, dict):
        channel_name = str(raw_channel.get("name") or "YouTube")
    elif isinstance(raw_channel, str) and raw_channel.strip():
        channel_name = raw_channel.strip()
    else:
        channel_name = "YouTube"

    raw_length = item.get("length")
    if raw_length:
        duration: str | None = str(raw_length)
    elif item.get("video_count"):
        duration = f"{item['video_count']} videos"
    else:
        duration = None

    raw_thumb = item.get("thumbnail")
    if isinstance(raw_thumb, dict):
        thumbnail: str | None = raw_thumb.get("static") or raw_thumb.get("rich")
    elif isinstance(raw_thumb, str) and raw_thumb.strip():
        thumbnail = raw_thumb.strip()
    else:
        thumbnail = None

    return CourseResource(
        title=title,
        url=link,
        source="YouTube",
        channel_or_site=channel_name,
        duration=duration,
        thumbnail=thumbnail,
    )


def _fetch_youtube_courses(skill: str, role: str, max_results: int = 2) -> list[CourseResource]:
    """Query SerpApi YouTube (with disk cache) and return up to max_results courses."""
    search_params: dict[str, Any] = {
        "engine": "youtube",
        "search_query": f"{skill} full course tutorial for {role}",
        "gl": "in",
        "hl": "en",
    }

    payload = get_cached(CACHE_NAMESPACE, search_params)
    if payload is None:
        api_key = os.getenv("SERPAPI_KEY", "").strip()
        if not api_key:
            return []

        request_params = {**search_params, "api_key": api_key}
        try:
            response = requests.get(SERPAPI_SEARCH_URL, params=request_params, timeout=20)
            response.raise_for_status()
            data = response.json()
        except (requests.RequestException, ValueError):
            return []

        if not isinstance(data, dict) or "error" in data:
            return []

        payload = data
        set_cached(CACHE_NAMESPACE, search_params, payload)

    raw_candidates: list[Any] = []
    raw_candidates.extend(payload.get("video_results") or [])
    if len(raw_candidates) < max_results:
        raw_candidates.extend(payload.get("playlist_results") or [])

    resources: list[CourseResource] = []
    for item in raw_candidates:
        if not isinstance(item, dict):
            continue
        parsed = _extract_course_resource(item)
        if parsed is not None:
            resources.append(parsed)
        if len(resources) >= max_results:
            break
    return resources


def _build_mini_project_idea(skill: str, role: str) -> str:
    """Generate a concise 2-sentence weekend proof-of-work project prompt."""
    skill_lower = skill.lower()
    templates: dict[str, str] = {
        "docker": (
            f"Containerize a realistic {role} service using a multi-stage Dockerfile and Docker "
            f"Compose setup with a local datastore. Publish the repo with one-command startup "
            f"and healthcheck verification to prove production-ready Docker skills."
        ),
        "kubernetes": (
            f"Deploy a containerized {role} application onto a local Kubernetes cluster (Minikube "
            f"or kind) with Deployment, Service, and readiness probe manifests. Document scaling "
            f"and rolling-update tests in your GitHub README as hands-on Kubernetes proof."
        ),
        "postgresql": (
            f"Design a normalized PostgreSQL schema with migrations and composite indexes for a "
            f"core {role} workflow. Share sample queries with EXPLAIN ANALYZE benchmarks in your "
            f"repository to demonstrate practical PostgreSQL tuning."
        ),
        "redis": (
            f"Integrate Redis caching and rate-limiting into a {role} API to speed up repeated "
            f"reads and protect hot endpoints. Include before-and-after latency benchmarks in your "
            f"README to showcase measurable Redis impact."
        ),
        "aws": (
            f"Build and deploy a small {role} workload on AWS using free-tier services such as "
            f"S3, Lambda, or EC2 with least-privilege IAM policies. Add an architecture diagram "
            f"and reproducible setup steps to prove real AWS deployment experience."
        ),
        "ci/cd": (
            f"Set up a GitHub Actions CI/CD pipeline for a {role} project that runs linting, "
            f"unit tests, and automated build checks on every pull request. Add status badges and "
            f"a sample failing-to-passing PR log to demonstrate reliable CI/CD automation."
        ),
    }
    if skill_lower in templates:
        return templates[skill_lower]

    return (
        f"Build a focused {role} weekend project centered on {skill} that solves one real "
        f"workflow end to end with clean sample data. Publish it on GitHub with automated checks "
        f"and a concise README showing how {skill} improves the solution."
    )


def attach_learning_resources(
    gaps: list[GapItem],
    role: str,
    top_n: int = 4,
) -> list[GapItem]:
    """Attach top YouTube courses and a weekend mini-project idea to the top_n gaps."""
    load_dotenv()

    enriched: list[GapItem] = []
    cutoff = max(0, top_n)
    for idx, gap in enumerate(gaps):
        if idx < cutoff:
            courses = _fetch_youtube_courses(gap.skill, role, max_results=2)
            project_idea = _build_mini_project_idea(gap.skill, role)
            enriched.append(
                gap.model_copy(
                    update={
                        "courses": courses,
                        "mini_project_idea": project_idea,
                    }
                )
            )
        else:
            enriched.append(gap)
    return enriched
