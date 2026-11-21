"""Dashboard tabs for SkillBridge: skill-gap charts, learning roadmap, job buckets, and demand table."""

from __future__ import annotations

import html

import pandas as pd
import plotly.express as px
import streamlit as st

from src.schemas import AnalysisResult, GapItem, JobPosting, SkillDemand
from ui.styles import render_skill_pills_html


def _render_gap_chart(gaps: list[GapItem]) -> None:
    """Render horizontal Plotly bar chart of top missing skills ranked by jobs unlocked."""
    st.subheader("Missing Skills Ranked by Jobs Unlocked")
    top_gaps = gaps[:12]
    if not top_gaps:
        st.success(
            "All tracked market skill gaps are covered! You match every required skill across the scanned postings."
        )
        return

    chart_df = pd.DataFrame(
        [
            {
                "Skill": gap.skill,
                "Jobs Unlocked": gap.jobs_unlocked,
                "Market Demand (%)": round(gap.demand_pct, 1),
            }
            for gap in top_gaps
        ]
    )

    fig = px.bar(
        chart_df,
        x="Jobs Unlocked",
        y="Skill",
        orientation="h",
        color="Jobs Unlocked",
        text="Jobs Unlocked",
        hover_data={"Market Demand (%)": ":.1f", "Jobs Unlocked": True, "Skill": False},
        color_continuous_scale="Tealgrn",
    )
    fig.update_traces(textposition="outside", cliponaxis=False)
    fig.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font={"color": "#E2E8F0"},
        yaxis={"categoryorder": "total ascending", "title": ""},
        xaxis={
            "title": "Jobs Unlocked",
            "gridcolor": "rgba(148, 163, 184, 0.14)",
            "zerolinecolor": "rgba(148, 163, 184, 0.2)",
        },
        coloraxis_showscale=False,
        margin={"l": 10, "r": 30, "t": 15, "b": 15},
        height=max(300, 34 * len(top_gaps) + 70),
    )
    st.plotly_chart(fig, width="stretch")


def _render_coverage_snapshot(
    current: AnalysisResult,
    user_skills: list[str],
    selected_simulated: list[str],
) -> None:
    """Render target role summary plus matched, simulated, and missing skill pills."""
    st.subheader("Skill Coverage Snapshot")
    st.caption(f"Target Role: **{current.role}** · Location: **{current.location}**")

    simulated_set = set(selected_simulated)
    matched_resume = [s for s in current.matched_skills if s not in simulated_set]
    if not matched_resume and user_skills:
        # Fallback when user has skills that did not appear in the scanned job set.
        matched_resume = [s for s in user_skills if s not in simulated_set]

    st.markdown("**Matched Resume Skills**")
    matched_html = render_skill_pills_html(matched_resume, variant="matched")
    if matched_html:
        st.markdown(matched_html, unsafe_allow_html=True)
    else:
        st.caption("No resume skills matched the scanned postings yet.")

    if selected_simulated:
        st.markdown("**Simulated Skills (What-If)**")
        sim_html = render_skill_pills_html(selected_simulated, variant="sim")
        if sim_html:
            st.markdown(sim_html, unsafe_allow_html=True)

    top_missing = [gap.skill for gap in current.missing_gaps[:10]]
    st.markdown("**Remaining Top Gaps**")
    missing_html = render_skill_pills_html(top_missing, variant="missing")
    if missing_html:
        st.markdown(missing_html, unsafe_allow_html=True)
    else:
        st.caption("No remaining skill gaps.")


def _render_learning_roadmap(
    missing_gaps: list[GapItem],
    courses_by_skill: dict[str, GapItem],
) -> None:
    """Render expandable learning roadmap and Weekend Proof-of-Work cards for missing gaps."""
    st.subheader("Learning Roadmap & Weekend Proof-of-Work")
    if not missing_gaps:
        st.success("No learning gaps left — you are ready to apply to the matched roles!")
        return

    for gap in missing_gaps:
        cached_gap = courses_by_skill.get(gap.skill, gap)
        expander_label = (
            f"#{gap.priority_rank} {gap.skill} — Unlocks {gap.jobs_unlocked} "
            f"job{'s' if gap.jobs_unlocked != 1 else ''} ({gap.demand_pct:.1f}% demand)"
        )
        with st.expander(expander_label, expanded=(gap.priority_rank == 1)):
            if cached_gap.mini_project_idea:
                st.info(f"**Weekend Proof-of-Work Mini-Project:** {cached_gap.mini_project_idea}")

            courses = cached_gap.courses
            if courses:
                cols = st.columns(len(courses))
                for col, course in zip(cols, courses):
                    with col:
                        if course.thumbnail:
                            st.image(course.thumbnail, width="stretch")
                        safe_title = course.title.replace("[", "\\[").replace("]", "\\]")
                        st.markdown(f"**[{safe_title}]({course.url})**")
                        meta_parts = [
                            part
                            for part in (course.channel_or_site, course.source, course.duration)
                            if part
                        ]
                        if meta_parts:
                            st.caption(" · ".join(meta_parts))
            elif gap.priority_rank <= 4:
                st.caption(
                    "No live video courses loaded for this skill (offline demo mode or YouTube API key not configured). "
                    "Use the Weekend Proof-of-Work mini-project above to demonstrate hands-on proficiency."
                )
            else:
                st.caption(
                    "Course recommendations are preloaded for your top 4 highest-impact skill gaps to conserve API quota. "
                    "Prioritize ranks #1–#4 first, then revisit this skill."
                )


def _render_job_card(
    job: JobPosting,
    effective_skills: set[str],
    simulated_set: set[str],
    is_ready: bool,
) -> None:
    """Render a single job posting card with escaped metadata, skill pills, and apply link."""
    matched_resume = [
        s for s in job.extracted_skills if s in effective_skills and s not in simulated_set
    ]
    matched_sim = [s for s in job.extracted_skills if s in simulated_set]
    missing_skills = [s for s in job.extracted_skills if s not in effective_skills]

    badge_class = "sb-badge-ready" if is_ready else "sb-badge-almost"
    if is_ready:
        badge_text = "Ready to Apply"
    else:
        miss_count = len(missing_skills)
        badge_text = f"{miss_count} Skill{'s' if miss_count != 1 else ''} Away"

    safe_title = html.escape(job.title)
    safe_company = html.escape(job.company)
    safe_location = html.escape(job.location)
    salary_part = f" &middot; {html.escape(job.salary_text)}" if job.salary_text else ""

    with st.container(border=True):
        st.markdown(
            (
                f'<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;">'
                f'<div>'
                f'<div style="font-size:1.02rem;font-weight:700;color:#F8FAFC;line-height:1.3;">{safe_title}</div>'
                f'<div style="font-size:0.86rem;color:#94A3B8;margin-top:0.2rem;">'
                f'{safe_company} &middot; {safe_location}{salary_part}'
                f'</div>'
                f'</div>'
                f'<span class="{badge_class}">{html.escape(badge_text)}</span>'
                f'</div>'
            ),
            unsafe_allow_html=True,
        )

        if matched_resume:
            st.caption("Matched Skills")
            st.markdown(render_skill_pills_html(matched_resume, variant="matched"), unsafe_allow_html=True)

        if matched_sim:
            st.caption("Simulated Skills")
            st.markdown(render_skill_pills_html(matched_sim, variant="sim"), unsafe_allow_html=True)

        if missing_skills:
            st.caption("Missing Skills")
            st.markdown(render_skill_pills_html(missing_skills, variant="missing"), unsafe_allow_html=True)

        if not job.extracted_skills:
            st.caption("No canonical technical skills extracted from this posting.")

        if job.apply_url:
            st.link_button("Apply Now", job.apply_url, width="stretch")


def _render_job_buckets_tab(
    current: AnalysisResult,
    effective_skills: set[str],
    simulated_set: set[str],
) -> None:
    """Render the two-bucket live job matches view (Ready vs 1-2 Skills Away)."""
    col_ready, col_almost = st.columns(2)

    with col_ready:
        st.subheader(f"Ready to Apply Today ({len(current.ready_jobs)})")
        if not current.ready_jobs:
            st.info(
                "No postings meet the >=75% skill match threshold yet. Toggle 1–2 high-impact skills in the simulator above to preview unlocked roles."
            )
        else:
            for job in current.ready_jobs:
                _render_job_card(job, effective_skills, simulated_set, is_ready=True)

    with col_almost:
        st.subheader(f"Almost Ready — 2–3 Skills Away ({len(current.almost_ready_jobs)})")
        if not current.almost_ready_jobs:
            st.info("No postings currently have 2–3 missing skills.")
        else:
            for job in current.almost_ready_jobs:
                _render_job_card(job, effective_skills, simulated_set, is_ready=False)


def _render_raw_demand_tab(
    demand_list: list[SkillDemand],
    user_skill_set: set[str],
    simulated_set: set[str],
) -> None:
    """Render the transparent market skill demand DataFrame."""
    st.subheader("Extracted Market Skills & Demand Transparency")
    if not demand_list:
        st.info("No canonical skills were extracted from the scanned job descriptions.")
        return
    rows: list[dict[str, object]] = []
    for item in demand_list:
        if item.skill in user_skill_set:
            status = "Matched"
        elif item.skill in simulated_set:
            status = "Simulated"
        else:
            status = "Missing"
        rows.append(
            {
                "Skill": item.skill,
                "Your Status": status,
                "Jobs Requiring Skill": item.job_count,
                "Total Jobs Scanned": item.total_jobs,
                "Market Demand (%)": round(item.demand_pct, 1),
            }
        )

    columns = [
        "Skill",
        "Your Status",
        "Jobs Requiring Skill",
        "Total Jobs Scanned",
        "Market Demand (%)",
    ]
    demand_df = pd.DataFrame(rows, columns=columns)
    st.dataframe(demand_df, width="stretch", hide_index=True)


def render_dashboard_tabs(
    current: AnalysisResult,
    user_skills: list[str],
    selected_simulated: list[str],
    demand_list: list[SkillDemand],
    courses_by_skill: dict[str, GapItem],
) -> None:
    """Render the three main SkillBridge analysis tabs: Skill Gaps, Job Matches, and Raw Market Demand."""
    tab_gaps, tab_jobs, tab_raw = st.tabs(
        [
            "Impact-Ranked Skill Gaps",
            "Live Job Matches (Two Buckets)",
            "Market Demand Raw Data",
        ]
    )

    user_skill_set = set(user_skills)
    simulated_set = set(selected_simulated)
    effective_skills = user_skill_set | simulated_set

    with tab_gaps:
        col_chart, col_snapshot = st.columns([3, 2])
        with col_chart:
            _render_gap_chart(current.missing_gaps)
        with col_snapshot:
            _render_coverage_snapshot(current, user_skills, selected_simulated)

        st.divider()
        _render_learning_roadmap(current.missing_gaps, courses_by_skill)

    with tab_jobs:
        _render_job_buckets_tab(current, effective_skills, simulated_set)

    with tab_raw:
        _render_raw_demand_tab(demand_list, user_skill_set, simulated_set)
