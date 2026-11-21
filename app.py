"""SkillBridge — Live Skill-Gap & Career Navigator Streamlit application."""

from __future__ import annotations

import streamlit as st

from src.schemas import AnalysisResult, GapItem, JobPosting, SkillDemand
from ui.jobs_and_roadmap import render_dashboard_tabs
from ui.sidebar import render_sidebar
from ui.simulator_panel import render_simulator_panel
from ui.state import init_session_state
from ui.styles import apply_custom_styles, render_hero_header


def main() -> None:
    """Configure page layout and orchestrate the SkillBridge Streamlit UI."""
    st.set_page_config(
        page_title="SkillBridge — Live Skill-Gap & Career Navigator",
        page_icon="🌉",
        layout="wide",
    )
    apply_custom_styles()
    init_session_state()
    render_hero_header()
    render_sidebar()

    if st.session_state.get("last_error"):
        st.error(st.session_state["last_error"])

    if not st.session_state.get("has_analyzed"):
        st.info(
            "Choose a **1-Click Sample Preset** or upload your **PDF resume** in the sidebar, "
            "then click **Analyze Live Market** (uses cached/live SerpApi + Gemini) or "
            "**Load Offline Demo** (0 API credits) to explore your skill-gap roadmap."
        )
        return

    if st.session_state.get("offline_demo_notice"):
        st.info(st.session_state["offline_demo_notice"])

    jobs: list[JobPosting] = st.session_state["jobs"]
    demand_list: list[SkillDemand] = st.session_state["demand_list"]
    user_skills: list[str] = st.session_state["user_skills"]
    baseline: AnalysisResult = st.session_state["baseline_result"]
    courses_by_skill: dict[str, GapItem] = st.session_state["courses_by_skill"]
    active_role: str = st.session_state["analysis_role"]
    active_location: str = st.session_state["analysis_location"]

    if not jobs:
        st.warning(
            f"No live jobs returned for **{active_role}** in **{active_location}**. "
            "Try broadening the role title, selecting another city, or clicking **Load Offline Demo**."
        )
        return

    current, selected_simulated = render_simulator_panel(
        baseline=baseline,
        user_skills=user_skills,
        jobs=jobs,
        demand_list=demand_list,
    )
    st.divider()
    render_dashboard_tabs(
        current=current,
        user_skills=user_skills,
        selected_simulated=selected_simulated,
        demand_list=demand_list,
        courses_by_skill=courses_by_skill,
    )


if __name__ == "__main__":
    main()
