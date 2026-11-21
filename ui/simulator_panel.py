"""Interactive KPI header and 'What-If' skill simulator panel for SkillBridge UI."""

from __future__ import annotations

import streamlit as st

from src.gap import analyze_skill_gaps
from src.schemas import AnalysisResult, JobPosting, SkillDemand


def render_simulator_panel(
    baseline: AnalysisResult,
    user_skills: list[str],
    jobs: list[JobPosting],
    demand_list: list[SkillDemand],
) -> tuple[AnalysisResult, list[str]]:
    """Render top KPI metrics and the interactive 'What-If' skill simulator.

    Reads simulator checkbox states from ``st.session_state`` before rendering
    metrics so KPI cards reflect toggled skills immediately on rerun.
    """
    top_5_gaps = baseline.missing_gaps[:5]
    selected_simulated = [
        gap.skill
        for gap in top_5_gaps
        if st.session_state.get(f"sim_skill_{gap.skill}", False)
    ]

    current = analyze_skill_gaps(
        role=baseline.role,
        location=baseline.location,
        user_skills=user_skills,
        jobs=jobs,
        demand_list=demand_list,
        simulated_skills=selected_simulated,
    )

    readiness_delta = round(current.readiness_score - baseline.readiness_score, 1)
    unlocked_delta = len(current.ready_jobs) - len(baseline.ready_jobs)

    col_readiness, col_scanned, col_ready, col_top_roi = st.columns(4)
    with col_readiness:
        st.metric(
            label="Readiness Score",
            value=f"{current.readiness_score:.1f}%",
            delta=f"+{readiness_delta:.1f}% Readiness" if readiness_delta > 0 else None,
        )
    with col_scanned:
        st.metric(
            label="Jobs Scanned",
            value=len(jobs),
        )
    with col_ready:
        st.metric(
            label="Ready to Apply",
            value=len(current.ready_jobs),
            delta=f"+{unlocked_delta} Jobs Unlocked" if unlocked_delta > 0 else None,
        )
    with col_top_roi:
        top_gap = current.missing_gaps[0] if current.missing_gaps else None
        st.metric(
            label="Top ROI Skill",
            value=top_gap.skill if top_gap else "All Covered",
            delta=(
                f"Unlocks {top_gap.jobs_unlocked}/{len(jobs)} jobs"
                if top_gap
                else None
            ),
        )

    if top_5_gaps:
        st.subheader('Interactive "What-If" Skill Simulator')
        st.caption(
            "Toggle top missing skills below to see your Readiness Score and eligible jobs update instantaneously."
        )
        # Render up to 3 checkboxes per row so labels never truncate on laptop screens.
        sim_cols = st.columns(min(len(top_5_gaps), 3))
        for idx, gap in enumerate(top_5_gaps):
            with sim_cols[idx % len(sim_cols)]:
                st.checkbox(
                    f"{gap.skill} (+{gap.jobs_unlocked})",
                    key=f"sim_skill_{gap.skill}",
                    help=f"Present in {gap.demand_pct:.0f}% of scanned openings",
                )

    if selected_simulated:
        st.success(
            f"**Simulation Active ({', '.join(selected_simulated)}):** "
            f"`+{readiness_delta:.1f}% Readiness` · `+{unlocked_delta} Jobs Unlocked`"
        )

    return current, selected_simulated
