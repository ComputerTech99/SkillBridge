"""Offline integration tests for Streamlit UI wiring and SerpApi error safety."""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from streamlit.testing.v1 import AppTest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import src.cache as cache
from src.jobs import fetch_live_jobs


def test_streamlit_app_end_to_end_offline() -> None:
    """Verify wired app.py + ui/ modules run offline, simulate toggles, and handle errors."""
    with (
        tempfile.TemporaryDirectory() as tmp_dir,
        patch.object(cache, "CACHE_DIR", Path(tmp_dir)),
        patch.dict(os.environ, {"GEMINI_API_KEY": "", "SERPAPI_KEY": ""}, clear=False),
    ):
        at = AppTest.from_file(str(PROJECT_ROOT / "app.py"), default_timeout=20)
        at.run()
        assert not at.exception
        assert len(at.info) == 1

        # Load offline demo for default Frontend persona
        at.sidebar.button(key="run_offline_demo_btn").click().run()
        assert not at.exception
        assert len(at.metric) == 4
        assert at.metric[0].value == "58.9%"
        assert at.metric[2].value == "2"
        assert at.metric[3].value == "TypeScript"

        # Toggle top ROI gap in What-If Simulator
        at.checkbox(key="sim_skill_TypeScript").check().run()
        assert not at.exception
        assert float(at.metric[0].value.rstrip("%")) > 58.9
        assert int(at.metric[2].value) > 2

        # Switch preset to Backend persona and reload offline demo
        at.sidebar.selectbox(key="demo_persona_select").select(
            "Junior Python Developer (Backend)"
        ).run()
        assert not at.exception
        at.sidebar.button(key="run_offline_demo_btn").click().run()
        assert not at.exception
        assert at.metric[0].value == "54.8%"
        assert at.metric[3].value == "Docker"

        # Missing SERPAPI_KEY should display a clean UI error without crashing
        at.sidebar.button(key="analyze_live_btn").click().run()
        assert not at.exception
        assert len(at.error) == 1
        assert "SERPAPI_KEY" in at.error[0].value


def test_serpapi_error_payload_is_not_cached() -> None:
    """Verify SerpApi HTTP-200 error payloads raise ValueError and are never cached."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"error": "Invalid API key"}
    mock_resp.raise_for_status.return_value = None

    with (
        patch.dict(os.environ, {"SERPAPI_KEY": "bad-key"}, clear=False),
        patch("src.jobs.requests.get", return_value=mock_resp),
        patch("src.jobs.set_cached") as mock_set_cached,
    ):
        try:
            fetch_live_jobs("Backend Developer", "Bengaluru, Karnataka, India", use_cache=False)
            raise AssertionError("Expected ValueError for SerpApi error payload")
        except ValueError as exc:
            assert "Invalid API key" in str(exc)
        mock_set_cached.assert_not_called()


if __name__ == "__main__":
    test_streamlit_app_end_to_end_offline()
    test_serpapi_error_payload_is_not_cached()
    print("ALL APP & INTEGRATION TESTS PASSED")
