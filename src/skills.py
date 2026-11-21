"""Hybrid LLM + regex-alias technical skill extraction and market demand aggregation."""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

from src.schemas import JobPosting, SkillDemand

load_dotenv()

_SKILLS_LIST_PATH = Path(__file__).resolve().parent.parent / "data" / "skills_list.json"
_GEMINI_MODEL = "gemini-2.5-flash"


def _load_skills_catalog(
    path: Path = _SKILLS_LIST_PATH,
) -> tuple[dict[str, list[str]], dict[str, str], list[tuple[str, re.Pattern[str]]]]:
    """Load canonical skills and compile word-boundary regex patterns for aliases."""
    with path.open("r", encoding="utf-8") as fh:
        raw_catalog: dict[str, list[str]] = json.load(fh)

    alias_to_canonical: dict[str, str] = {}
    compiled_patterns: list[tuple[str, re.Pattern[str]]] = []

    for canonical, aliases in raw_catalog.items():
        alias_to_canonical[canonical.lower()] = canonical
        terms = [canonical, *aliases]
        unique_terms: list[str] = []
        seen_terms: set[str] = set()
        for term in terms:
            cleaned = term.strip()
            lowered = cleaned.lower()
            if cleaned and lowered not in seen_terms:
                seen_terms.add(lowered)
                unique_terms.append(cleaned)
                alias_to_canonical[lowered] = canonical

        # Lookarounds instead of \b so symbol-containing skills (C++, C#, .NET) match accurately.
        escaped = "|".join(re.escape(t) for t in sorted(unique_terms, key=len, reverse=True))
        pattern = re.compile(rf"(?<!\w)(?:{escaped})(?!\w)", re.IGNORECASE)
        compiled_patterns.append((canonical, pattern))

    return raw_catalog, alias_to_canonical, compiled_patterns


_SKILLS_CATALOG, _ALIAS_TO_CANONICAL, _COMPILED_SKILL_PATTERNS = _load_skills_catalog()


def _deduplicate_and_normalize(skills: list[str]) -> list[str]:
    """Map aliases to canonical names and preserve order without duplicates."""
    result: list[str] = []
    seen: set[str] = set()

    for raw in skills:
        if not isinstance(raw, str):
            continue
        cleaned = raw.strip()
        if not cleaned:
            continue
        canonical = _ALIAS_TO_CANONICAL.get(cleaned.lower(), cleaned)
        key = canonical.lower()
        if key not in seen:
            seen.add(key)
            result.append(canonical)

    return result


def _extract_skills_regex(text: str) -> list[str]:
    """Extract canonical skills using compiled word-boundary alias patterns."""
    matched = [
        canonical
        for canonical, pattern in _COMPILED_SKILL_PATTERNS
        if pattern.search(text)
    ]
    return _deduplicate_and_normalize(matched)


def _extract_skills_llm(text: str, api_key: str) -> list[str]:
    """Extract and normalize canonical technical skills using Gemini structured JSON output."""
    canonical_names = ", ".join(_SKILLS_CATALOG.keys())
    prompt = (
        "Extract all technical skills, programming languages, frameworks, databases, "
        "cloud platforms, DevOps tools, and engineering concepts explicitly mentioned in "
        "the text below.\n"
        "Normalize aliases to their canonical names whenever applicable using this "
        f"reference taxonomy: [{canonical_names}].\n"
        "Return ONLY a JSON array of deduplicated canonical skill strings. Do not invent "
        "skills that are not present in the text.\n\n"
        f"Text:\n{text}"
    )

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=_GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=list[str],
            temperature=0.0,
        ),
    )

    parsed = getattr(response, "parsed", None)
    if parsed is None:
        raw_text = getattr(response, "text", None) or ""
        parsed = json.loads(raw_text)

    if not isinstance(parsed, list):
        raise ValueError("LLM response was not a JSON list of skills")

    return _deduplicate_and_normalize([str(item) for item in parsed])


def extract_skills_from_text(text: str) -> list[str]:
    """Extract deduplicated canonical technical skills from resume or job text.

    Uses Gemini (`gemini-2.5-flash`) structured JSON output when `GEMINI_API_KEY` is
    configured, automatically falling back to regex word-boundary matching against
    `data/skills_list.json` if the key is missing or the API call fails.
    """
    if not text or not text.strip():
        return []

    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if api_key:
        try:
            return _extract_skills_llm(text, api_key)
        except Exception:
            pass

    return _extract_skills_regex(text)


def enrich_jobs_with_skills(jobs: list[JobPosting]) -> list[JobPosting]:
    """Populate `extracted_skills` on each JobPosting from qualifications and description."""
    for job in jobs:
        combined_text = "\n".join(
            part for part in [*job.qualifications, job.description] if part and part.strip()
        )
        job.extracted_skills = extract_skills_from_text(combined_text)
    return jobs


def compute_market_demand(jobs: list[JobPosting]) -> list[SkillDemand]:
    """Aggregate job counts and percentages per skill, sorted descending by job_count."""
    total_jobs = len(jobs)
    if total_jobs == 0:
        return []

    skill_job_ids: dict[str, list[str]] = defaultdict(list)
    skill_seen_jobs: dict[str, set[str]] = defaultdict(set)

    for job in jobs:
        for skill in _deduplicate_and_normalize(job.extracted_skills):
            if job.job_id not in skill_seen_jobs[skill]:
                skill_seen_jobs[skill].add(job.job_id)
                skill_job_ids[skill].append(job.job_id)

    demands = [
        SkillDemand(
            skill=skill,
            job_count=len(job_ids),
            total_jobs=total_jobs,
            demand_pct=round((len(job_ids) / total_jobs) * 100, 2),
            unlocked_job_ids=job_ids,
        )
        for skill, job_ids in skill_job_ids.items()
    ]
    demands.sort(key=lambda item: (-item.job_count, item.skill.lower()))
    return demands
