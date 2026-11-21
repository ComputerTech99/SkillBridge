"""SkillBridge — Live Skill-Gap & Career Navigator Streamlit dashboard."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import plotly.express as px
import streamlit as st

from src.courses import attach_learning_resources
from src.gap import analyze_skill_gaps
from src.jobs import fetch_live_jobs
from src.resume_parser import clean_resume_text, extract_text_from_pdf
from src.schemas import AnalysisResult, GapItem, JobPosting, SkillDemand
from src.skills import compute_market_demand, enrich_jobs_with_skills, extract_skills_from_text

SAMPLE_RESUMES_PATH = Path(__file__).resolve().parent / "data" / "sample_resumes.json"
CITY_OPTIONS = [
    "Bengaluru, Karnataka, India",
    "Mumbai, Maharashtra, India",
    "Remote",
]

_FALLBACK_PRESETS: list[dict[str, str]] = [
    {
        "label": "CS Student — Backend Focus",
        "role": "Backend Developer",
        "text": (
            "Final-year Computer Science undergraduate with project experience in Python, "
            "FastAPI, SQL, PostgreSQL, Git, and REST APIs. Built a student course tracker "
            "using Python and SQLite deployed on Linux."
        ),
    },
    {
        "label": "Junior Frontend Developer",
        "role": "Frontend Developer",
        "text": (
            "Frontend developer with 1 year of internship experience in JavaScript, HTML, CSS, "
            "React, Tailwind CSS, and Git. Built responsive dashboards consuming REST APIs."
        ),
    },
    {
        "label": "Aspiring Data Analyst",
        "role": "Data Analyst",
        "text": (
            "Economics and Data Science graduate skilled in Python, Pandas, NumPy, SQL, Excel, "
            "and Tableau. Completed capstone EDA and sales forecasting notebooks."
        ),
    },
]


def _normalize_presets(raw: Any) -> list[dict[str, str]]:
    """Normalize arbitrary JSON sample_resumes formats into a uniform list of dicts."""
    presets: list[dict[str, str]] = []
    if isinstance(raw, dict):
        for name, value in raw.items():
            if isinstance(value, str):
                presets.append({"label": str(name), "role": "Backend Developer", "text": value})
            elif isinstance(value, dict):
                text = str(
                    value.get("resume_text")
                    or value.get("text")
                    or value.get("content")
                    or value.get("summary")
                    or ""
                )
                role = str(value.get("target_role") or value.get("role") or "Backend Developer")
                if text.strip():
                    presets.append({"label": str(name), "role": role, "text": text})
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
            role = str(item.get("target_role") or item.get("role") or "Backend Developer")
            if text.strip():
                presets.append({"label": label, "role": role, "text": text})
    return presets


def _load_sample_resumes() -> list[dict[str, str]]:
    """Load 1-click resume presets from data/sample_resumes.json with safe fallback."""
    if SAMPLE_RESUMES_PATH.is_file():
        try:
            raw = json.loads(SAMPLE_RESUMES_PATH.read_text(encoding="utf-8"))
            parsed = _normalize_presets(raw)
            if parsed:
                return parsed
        except (OSError, json.JSONDecodeError, ValueError):
            pass
    return _FALLBACK_PRESETS


def _init_session_state() -> None:
    """Initialize required st.session_state keys once."""
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
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def _clear_simulator_checkboxes() -> None:
    """Reset any What-If skill simulator checkboxes on fresh market analysis."""
    for key in list(st.session_state.keys()):
        if isinstance(key, str) and key.startswith("sim_skill_"):
            del st.session_state[key]


def _run_market_analysis(resume_text: str, role: str, location: str) -> None:
    """Execute the full live SerpApi + skill extraction pipeline and cache in session_state."""
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

    # Fetch YouTube tutorials + weekend mini-projects once for top missing gaps.
    enriched_top_gaps = attach_learning_resources(baseline.missing_gaps, role=role, top_n=4)
    courses_by_skill = {gap.skill: gap for gap in enriched_top_gaps[:4]}

    st.session_state["resume_text"] = cleaned_resume
    st.session_state["user_skills"] = user_skills
    st.session_state["jobs"] = enriched_jobs
    st.session_state["demand_list"] = demand_list
    st.session_state["analysis_role"] = role
    st.session_state["analysis_location"] = location
    st.session_state["baseline_result"] = baseline
    st.session_state["courses_by_skill"] = courses_by_skill
    st.session_state["has_analyzed"] = True
    st.session_state["last_error"] = None
    _clear_simulator_checkboxes()


def _render_job_card(job: JobPosting, effective_skills: set[str], is_ready: bool) -> None:
    """Render a clean job card showing matched/missing skills and direct apply link."""
    job_skills = set(job.extracted_skills)
    matched = sorted(job_skills & effective_skills)
    missing = sorted(job_skills - effective_skills)

    with st.container(border=True):
        header_col, action_col = st.columns([3, 1])
        with header_col:
            badge = "Ready to Apply" if is_ready else f"Missing {len(missing)} Skill(s)"
            st.markdown(f"**{job.title}** — {job.company}  \n`{badge}` · {job.location}")
            if job.salary_text:
                st.caption(f"Salary: {job.salary_text}")
        with action_col:
            if job.apply_url:
                st.link_button("Apply Now", job.apply_url, width="stretch")
            else:
                st.caption("No direct link")

        if matched:
            matched_tags = " ".join(f"`{skill}`" for skill in matched)
            st.markdown(f"**Matched:** {matched_tags}")
        if missing:
            missing_tags = " ".join(f"`{skill}`" for skill in missing)
            st.markdown(f"**Missing:** {missing_tags}")


def _render_learning_plan(gaps: list[GapItem], courses_by_skill: dict[str, GapItem]) -> None:
    """Render expandable gap cards with YouTube tutorials and Weekend Proof-of-Work boxes."""
    st.subheader("Learning Roadmap & Weekend Proof-of-Work")
    if not gaps:
        st.success("No missing skill gaps remain for the scanned openings!")
        return

    for gap in gaps:
        cached_gap = courses_by_skill.get(gap.skill, gap)
        label = (
            f"#{gap.priority_rank} {gap.skill} — Unlocks {gap.jobs_unlocked} job(s) "
            f"({gap.demand_pct:.0f}% market demand)"
        )
        with st.expander(label, expanded=(gap.priority_rank == 1)):
            if cached_gap.mini_project_idea:
                st.info(
                    f"**Weekend Proof-of-Work Mini-Project:** {cached_gap.mini_project_idea}"
                )

            if cached_gap.courses:
                cols = st.columns(len(cached_gap.courses))
                for col, course in zip(cols, cached_gap.courses):
                    with col:
                        if course.thumbnail:
                            st.image(course.thumbnail, width="stretch")
                        st.markdown(f"**[{course.title}]({course.url})**")
                        meta_parts = [course.channel_or_site, course.source]
                        if course.duration:
                            meta_parts.append(course.duration)
                        st.caption(" · ".join(meta_parts))
            elif gap.priority_rank <= 4:
                st.caption("No YouTube tutorials found or cached for this skill yet.")
            else:
                st.caption(
                    "Outside the top 4 SerpApi course lookups to conserve API credits."
                )


def main() -> None:
    """Render the SkillBridge Streamlit application."""
    st.set_page_config(
        page_title="SkillBridge — Live Skill-Gap & Career Navigator",
        page_icon="🌉",
        layout="wide",
    )
    _init_session_state()

    st.title("SkillBridge — Live Skill-Gap & Career Navigator")
    st.caption(
        "Connect your resume to live local job openings, rank missing skills by ROI, "
        "and simulate closing the gap in real time."
    )

    presets = _load_sample_resumes()
    preset_map = {item["label"]: item for item in presets}

    with st.sidebar:
        st.header("Your Profile & Target Market")
        input_mode = st.radio(
            "Resume Input",
            options=["1-Click Sample Preset", "Upload Resume PDF"],
            horizontal=False,
        )

        uploaded_pdf = None
        selected_preset_label = presets[0]["label"]
        default_role = presets[0]["role"]

        if input_mode == "1-Click Sample Preset":
            selected_preset_label = st.selectbox(
                "Choose a Demo Persona",
                options=list(preset_map.keys()),
            )
            default_role = preset_map[selected_preset_label]["role"]
            if st.session_state.get("_last_preset") != selected_preset_label:
                st.session_state["_last_preset"] = selected_preset_label
                st.session_state["target_role_input"] = default_role
            with st.expander("Preview Sample Resume"):
                st.write(preset_map[selected_preset_label]["text"])
        else:
            uploaded_pdf = st.file_uploader("Upload Resume (PDF)", type=["pdf"])

        if "target_role_input" not in st.session_state:
            st.session_state["target_role_input"] = default_role
        target_role = st.text_input("Target Role", key="target_role_input").strip()
        selected_city = st.selectbox("City / Market", options=CITY_OPTIONS)
        analyze_clicked = st.button(
            "Analyze Live Market",
            type="primary",
            width="stretch",
        )

        if st.session_state["has_analyzed"]:
            st.divider()
            st.subheader("Extracted Resume Skills")
            user_skills: list[str] = st.session_state["user_skills"]
            if user_skills:
                st.write(", ".join(f"`{s}`" for s in user_skills))
            else:
                st.caption("No canonical skills matched in resume text.")

    if analyze_clicked:
        if not target_role:
            st.session_state["last_error"] = "Please enter a Target Role before analyzing."
        else:
            try:
                if input_mode == "Upload Resume PDF":
                    if uploaded_pdf is None:
                        raise ValueError("Please upload a PDF resume or switch to a Sample Preset.")
                    resume_text = extract_text_from_pdf(uploaded_pdf.getvalue())
                else:
                    resume_text = preset_map[selected_preset_label]["text"]

                with st.spinner("Scanning live job market & extracting skills..."):
                    _run_market_analysis(resume_text, target_role, selected_city)
            except Exception as exc:
                st.session_state["last_error"] = str(exc)

    if st.session_state["last_error"]:
        st.error(st.session_state["last_error"])

    if not st.session_state["has_analyzed"]:
        st.info(
            "Choose a **1-Click Sample Preset** or upload your **PDF resume** in the sidebar, "
            "then click **Analyze Live Market** to inspect live openings."
        )
        return

    jobs: list[JobPosting] = st.session_state["jobs"]
    demand_list: list[SkillDemand] = st.session_state["demand_list"]
    user_skills = st.session_state["user_skills"]
    baseline: AnalysisResult = st.session_state["baseline_result"]
    courses_by_skill: dict[str, GapItem] = st.session_state["courses_by_skill"]
    active_role: str = st.session_state["analysis_role"]
    active_location: str = st.session_state["analysis_location"]

    if not jobs:
        st.warning(
            f"No live jobs returned for **{active_role}** in **{active_location}**. "
            "Try broadening the role title or selecting another city."
        )
        return

    top_5_gaps = baseline.missing_gaps[:5]
    selected_simulated: list[str] = [
        gap.skill
        for gap in top_5_gaps
        if st.session_state.get(f"sim_skill_{gap.skill}", False)
    ]

    current: AnalysisResult = analyze_skill_gaps(
        role=active_role,
        location=active_location,
        user_skills=user_skills,
        jobs=jobs,
        demand_list=demand_list,
        simulated_skills=selected_simulated,
    )

    readiness_delta = round(current.readiness_score - baseline.readiness_score, 1)
    unlocked_delta = len(current.ready_jobs) - len(baseline.ready_jobs)

    # --- Top Metrics Row ---
    m1, m2, m3, m4 = st.columns(4)
    with m1:
        st.metric(
            label="Readiness Score (%)",
            value=f"{current.readiness_score:.1f}%",
            delta=f"+{readiness_delta:.1f}% Readiness" if readiness_delta > 0 else None,
        )
    with m2:
        st.metric(
            label="Live Jobs Scanned",
            value=len(jobs),
        )
    with m3:
        st.metric(
            label="Ready to Apply Today",
            value=len(current.ready_jobs),
            delta=f"+{unlocked_delta} Jobs Unlocked" if unlocked_delta > 0 else None,
        )
    with m4:
        top_roi = current.missing_gaps[0].skill if current.missing_gaps else "All Covered"
        top_roi_delta = (
            f"Unlocks {current.missing_gaps[0].jobs_unlocked}/{len(jobs)} jobs"
            if current.missing_gaps
            else None
        )
        st.metric(
            label="Top ROI Skill",
            value=top_roi,
            delta=top_roi_delta,
        )

    # --- Interactive "What-If" Skill Simulator ---
    if top_5_gaps:
        st.subheader('Interactive "What-If" Skill Simulator')
        st.caption(
            "Toggle any of the top 5 missing skills below to simulate learning them and "
            "watch your Readiness Score and eligible jobs update instantaneously."
        )
        sim_cols = st.columns(len(top_5_gaps))
        for col, gap in zip(sim_cols, top_5_gaps):
            with col:
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

    st.divider()

    # --- Three Visual Dashboard Tabs ---
    effective_skills = set(user_skills) | set(selected_simulated)
    tab_gaps, tab_jobs, tab_raw = st.tabs(
        [
            "Impact-Ranked Skill Gaps",
            "Live Job Matches (Two Buckets)",
            "Market Demand Raw Data",
        ]
    )

    with tab_gaps:
        chart_col, summary_col = st.columns([3, 2])
        with chart_col:
            st.subheader("Missing Skills Ranked by Jobs Unlocked")
            if current.missing_gaps:
                gap_df = pd.DataFrame(
                    [
                        {
                            "Skill": g.skill,
                            "Jobs Unlocked": g.jobs_unlocked,
                            "Market Demand (%)": g.demand_pct,
                        }
                        for g in current.missing_gaps[:12]
                    ]
                )
                fig = px.bar(
                    gap_df,
                    x="Jobs Unlocked",
                    y="Skill",
                    orientation="h",
                    text="Jobs Unlocked",
                    hover_data=["Market Demand (%)"],
                    color="Jobs Unlocked",
                    color_continuous_scale="Tealgrn",
                )
                fig.update_layout(
                    yaxis={"categoryorder": "total ascending"},
                    coloraxis_showscale=False,
                    height=360,
                    margin={"l": 10, "r": 10, "t": 10, "b": 10},
                )
                st.plotly_chart(fig, width="stretch")
            else:
                st.success("Your effective skill set covers all detected market requirements!")

        with summary_col:
            st.subheader("Skill Coverage Snapshot")
            st.markdown(f"**Target:** `{active_role}` in `{active_location}`")
            st.markdown(
                f"**Matched Skills ({len(current.matched_skills)}):** "
                + (", ".join(f"`{s}`" for s in current.matched_skills) or "_None yet_")
            )
            remaining_names = [g.skill for g in current.missing_gaps[:8]]
            st.markdown(
                f"**Top Missing Gaps ({len(current.missing_gaps)}):** "
                + (", ".join(f"`{s}`" for s in remaining_names) or "_None_")
            )

        st.divider()
        _render_learning_plan(current.missing_gaps, courses_by_skill)

    with tab_jobs:
        col_ready, col_almost = st.columns(2)
        with col_ready:
            st.subheader(f"Ready to Apply Today ({len(current.ready_jobs)})")
            if current.ready_jobs:
                for job in current.ready_jobs:
                    _render_job_card(job, effective_skills, is_ready=True)
            else:
                st.info(
                    "No jobs meet the >=75% match threshold yet. Toggle skills in the "
                    "\"What-If\" Simulator above to unlock jobs!"
                )

        with col_almost:
            st.subheader(f"1–2 Skills Away ({len(current.almost_ready_jobs)})")
            if current.almost_ready_jobs:
                for job in current.almost_ready_jobs:
                    _render_job_card(job, effective_skills, is_ready=False)
            else:
                st.caption("No jobs currently fall in the almost-ready bucket.")

    with tab_raw:
        st.subheader("Extracted Market Skills & Demand Transparency")
        if demand_list:
            sim_set = set(selected_simulated)
            user_set = set(user_skills)
            demand_df = pd.DataFrame(
                [
                    {
                        "Skill": item.skill,
                        "Your Status": (
                            "Matched"
                            if item.skill in user_set
                            else ("Simulated" if item.skill in sim_set else "Missing")
                        ),
                        "Jobs Requiring Skill": item.job_count,
                        "Total Jobs Scanned": item.total_jobs,
                        "Market Demand (%)": round(item.demand_pct, 1),
                    }
                    for item in demand_list
                ]
            )
            st.dataframe(demand_df, width="stretch", hide_index=True)
        else:
            st.info("No canonical skills were extracted from the scanned job descriptions.")


if __name__ == "__main__":
    main()
