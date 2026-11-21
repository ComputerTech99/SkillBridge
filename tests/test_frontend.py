"""Offline headless UI smoke tests for the SkillBridge Streamlit dashboard."""

from __future__ import annotations

import os
import sys
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import src.cache as cache  # noqa: E402
import src.courses  # noqa: E402
import src.jobs  # noqa: E402
import src.skills  # noqa: E402
import ui.state  # noqa: E402
from src.courses import _build_mini_project_idea  # noqa: E402
from src.schemas import CourseResource, GapItem, JobPosting  # noqa: E402


@contextmanager
def _zero_credit_guard() -> Iterator[None]:
    """Ensure zero SerpApi or Gemini network calls occur during frontend tests."""
    with (
        patch.dict(os.environ, {"SERPAPI_KEY": "", "GEMINI_API_KEY": ""}, clear=False),
        patch(
            "src.jobs.requests.get",
            side_effect=AssertionError("SerpApi jobs HTTP request must not be called"),
        ),
        patch(
            "src.courses.requests.get",
            side_effect=AssertionError("SerpApi courses HTTP request must not be called"),
        ),
        patch(
            "src.skills.genai.Client",
            side_effect=AssertionError("Gemini LLM client must not be called"),
        ),
    ):
        yield


def _build_mock_live_jobs(role: str, location: str, limit: int = 10, use_cache: bool = True) -> list[JobPosting]:
    """Return deterministic backend JobPosting fixtures for mocked live-mode testing."""
    del role, limit, use_cache
    return [
        JobPosting(
            job_id="live-mock-1",
            title="Junior Backend Python Engineer",
            company="FinLedger Mock",
            location=location,
            salary_text="8 - 12 LPA",
            qualifications=["Proficiency in Python, Flask, PostgreSQL, REST API, and Git."],
            description="Maintain Python and Flask REST API microservices backed by PostgreSQL and Git.",
            apply_url="https://example.com/jobs/live-mock-1",
        ),
        JobPosting(
            job_id="live-mock-2",
            title="Python API Developer",
            company="CloudScale Mock",
            location=location,
            salary_text="10 - 15 LPA",
            qualifications=["Strong experience with Python, Django, PostgreSQL, and Docker."],
            description="Build containerized Django REST API services using Docker and Git.",
            apply_url="https://example.com/jobs/live-mock-2",
        ),
        JobPosting(
            job_id="live-mock-3",
            title="Platform Python Engineer",
            company="NexaOps Mock",
            location=location,
            salary_text="12 - 18 LPA",
            qualifications=["Experience with Python, FastAPI, Docker, and Redis."],
            description="Deploy FastAPI services in Docker with Redis caching and Pytest.",
            apply_url="https://example.com/jobs/live-mock-3",
        ),
    ]


def _mock_attach_learning_resources(
    gaps: list[GapItem], role: str, top_n: int = 4
) -> list[GapItem]:
    """Attach deterministic YouTube CourseResource entries without external HTTP calls."""
    enriched: list[GapItem] = []
    for idx, gap in enumerate(gaps):
        if idx < top_n:
            slug = gap.skill.lower().replace(" ", "-")
            course = CourseResource(
                title=f"{gap.skill} Crash Course for {role}",
                url=f"https://www.youtube.com/watch?v={slug}-demo",
                source="YouTube",
                channel_or_site="TechAcademy Demo",
                duration="45:00",
                thumbnail=None,
            )
            enriched.append(
                gap.model_copy(
                    update={
                        "courses": [course],
                        "mini_project_idea": _build_mini_project_idea(gap.skill, role),
                    }
                )
            )
        else:
            enriched.append(gap)
    return enriched


def test_initial_render_offline() -> None:
    """Verify initial dashboard load renders onboarding info and sidebar action buttons."""
    with _zero_credit_guard():
        at = AppTest.from_file(str(PROJECT_ROOT / "app.py"), default_timeout=20).run()

        assert not at.exception
        assert len(at.info) >= 1
        assert "1-Click Sample Preset" in at.info[0].value

        sidebar_button_keys = {btn.key for btn in at.sidebar.button}
        assert "quick_demo_student_btn" in sidebar_button_keys
        assert "quick_demo_backend_btn" in sidebar_button_keys
        assert "analyze_live_btn" in sidebar_button_keys
        assert "run_offline_demo_btn" in sidebar_button_keys


def test_one_click_judge_buttons_and_job_unlock() -> None:
    """Verify 1-click sidebar preset buttons and What-If job unlocking into Ready Today."""
    with (
        tempfile.TemporaryDirectory() as tmp_dir,
        patch.object(cache, "CACHE_DIR", Path(tmp_dir)),
        _zero_credit_guard(),
    ):
        at = AppTest.from_file(str(PROJECT_ROOT / "app.py"), default_timeout=20).run()

        # 1-click CS Final-Year Student button
        at.sidebar.button(key="quick_demo_student_btn").click().run()
        assert not at.exception
        assert at.session_state["has_analyzed"] is True
        assert at.session_state["analysis_role"] == "Frontend Developer"

        # 1-click Junior Backend Dev button
        at.sidebar.button(key="quick_demo_backend_btn").click().run()
        assert not at.exception
        assert at.session_state["analysis_role"] == "Backend Python Developer"
        base_score = float(str(at.metric[0].value).rstrip("%"))
        base_ready = int(at.metric[2].value)

        # Toggle top missing skill (Docker) -> Readiness & Ready to Apply must jump
        at.checkbox(key="sim_skill_Docker").check().run()
        assert not at.exception
        new_score = float(str(at.metric[0].value).rstrip("%"))
        new_ready = int(at.metric[2].value)
        assert new_score > base_score
        assert new_ready > base_ready


def test_seeded_cache_zero_http_calls() -> None:
    """Verify seeded data/cache/ serves live-format demos with 0 HTTP calls and 0 API keys."""
    cache_files = list(cache.CACHE_DIR.glob("*.json"))
    if not cache_files:
        return

    with _zero_credit_guard():
        at = AppTest.from_file(str(PROJECT_ROOT / "app.py"), default_timeout=20).run()
        at.sidebar.button(key="quick_demo_student_btn").click().run()
        assert not at.exception
        assert at.session_state["analysis_mode"] == "live_or_cached"
        assert len(at.session_state["jobs"]) > 0
        base_score = float(str(at.metric[0].value).rstrip("%"))

        # Toggle first gap in simulator
        assert len(at.checkbox) >= 1
        at.checkbox[0].check().run()
        assert not at.exception
        assert float(str(at.metric[0].value).rstrip("%")) > base_score


def test_offline_demo_and_what_if_simulator() -> None:
    """Verify offline demo execution and interactive What-If skill simulator updates."""
    with _zero_credit_guard():
        at = AppTest.from_file(str(PROJECT_ROOT / "app.py"), default_timeout=20).run()
        at.sidebar.button(key="run_offline_demo_btn").click().run()

        assert not at.exception
        assert at.session_state["has_analyzed"] is True
        assert at.session_state["analysis_mode"] == "offline_demo"
        assert len(at.metric) == 4

        baseline_score = float(str(at.metric[0].value).rstrip("%"))

        assert len(at.checkbox) >= 1
        assert str(at.checkbox[0].key).startswith("sim_skill_")
        at.checkbox[0].check().run()

        assert not at.exception
        new_score = float(str(at.metric[0].value).rstrip("%"))
        assert new_score > baseline_score
        assert any("Simulation Active" in msg.value for msg in at.success)


def test_mocked_live_analysis_renders_courses_and_jobs() -> None:
    """Verify mocked live analysis populates live_or_cached state, courses, jobs, tabs, and table."""
    with (
        _zero_credit_guard(),
        patch("ui.state.fetch_live_jobs", side_effect=_build_mock_live_jobs),
        patch("ui.state.attach_learning_resources", side_effect=_mock_attach_learning_resources),
    ):
        at = AppTest.from_file(str(PROJECT_ROOT / "app.py"), default_timeout=20).run()
        assert not at.exception

        at.sidebar.selectbox(key="demo_persona_select").select(
            "Junior Python Developer (Backend)"
        ).run()
        assert not at.exception

        at.sidebar.button(key="analyze_live_btn").click().run()

        assert not at.exception
        assert at.session_state["has_analyzed"] is True
        assert at.session_state["analysis_mode"] == "live_or_cached"
        assert len(at.metric) == 4
        assert len(at.tabs) == 3
        assert len(at.dataframe) == 1
        assert len(at.dataframe[0].value) > 0

        courses_by_skill = at.session_state["courses_by_skill"]
        assert len(courses_by_skill) >= 1
        first_gap = next(iter(courses_by_skill.values()))
        assert len(first_gap.courses) == 1
        assert first_gap.courses[0].source == "YouTube"
        assert any(first_gap.courses[0].title in md.value for md in at.markdown)


if __name__ == "__main__":
    test_initial_render_offline()
    test_offline_demo_and_what_if_simulator()
    test_one_click_judge_buttons_and_job_unlock()
    test_seeded_cache_zero_http_calls()
    test_mocked_live_analysis_renders_courses_and_jobs()
    print("ALL FRONTEND SMOKE TESTS PASSED (0 API credits used)")
