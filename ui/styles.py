"""Dark-mode visual styling, hero banner, and escaped HTML badge/pill helpers."""

from __future__ import annotations

import html

import streamlit as st

_PILL_CLASS_BY_VARIANT: dict[str, str] = {
    "matched": "sb-pill sb-pill-matched",
    "missing": "sb-pill sb-pill-missing",
    "sim": "sb-pill sb-pill-sim",
}

_CUSTOM_CSS = """
<style>
/* Layout & typography polish */
.block-container {
    padding-top: 1.5rem;
    padding-bottom: 2.5rem;
    max-width: 1260px;
}

/* Hero Banner */
.sb-hero {
    background: linear-gradient(135deg, #0F172A 0%, #111827 55%, #0D3B3E 100%);
    border: 1px solid rgba(20, 184, 166, 0.28);
    border-radius: 16px;
    padding: 1.5rem 1.75rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.sb-hero-badge {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #2DD4BF;
    background: rgba(20, 184, 166, 0.14);
    border: 1px solid rgba(45, 212, 191, 0.32);
    border-radius: 999px;
    padding: 0.22rem 0.7rem;
    margin-bottom: 0.6rem;
}

.sb-hero-title {
    margin: 0;
    font-size: 1.95rem;
    font-weight: 800;
    line-height: 1.2;
    color: #F8FAFC;
    letter-spacing: -0.02em;
}

.sb-hero-subtitle {
    margin: 0.45rem 0 0 0;
    font-size: 0.98rem;
    line-height: 1.5;
    color: #CBD5E1;
    max-width: 780px;
}

/* Metric Cards */
[data-testid="stMetric"],
.sb-metric-card {
    background: linear-gradient(180deg, #111827 0%, #0F172A 100%);
    border: 1px solid #1E293B;
    border-radius: 12px;
    padding: 0.8rem 0.9rem;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}

[data-testid="stMetricLabel"] {
    color: #94A3B8;
    font-weight: 600;
    font-size: 0.82rem;
}

[data-testid="stMetricValue"] {
    color: #F8FAFC;
    font-weight: 700;
    font-size: 1.55rem;
}

/* Skill Pills */
.sb-pills-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.35rem 0 0.55rem 0;
}

.sb-pill {
    display: inline-block;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.2;
    padding: 0.28rem 0.62rem;
    border-radius: 999px;
    border: 1px solid #334155;
    background: #1E293B;
    color: #E2E8F0;
    white-space: nowrap;
}

.sb-pill-matched {
    background: rgba(16, 185, 129, 0.14);
    border-color: rgba(16, 185, 129, 0.4);
    color: #6EE7B7;
}

.sb-pill-missing {
    background: rgba(244, 63, 94, 0.14);
    border-color: rgba(244, 63, 94, 0.38);
    color: #FDA4AF;
}

.sb-pill-sim {
    background: rgba(20, 184, 166, 0.16);
    border-color: rgba(45, 212, 191, 0.45);
    color: #5EEAD4;
}

/* Job Card Badges */
.sb-badge-ready {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.16);
    border: 1px solid rgba(16, 185, 129, 0.45);
    color: #6EE7B7;
    white-space: nowrap;
    flex-shrink: 0;
}

.sb-badge-almost {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: rgba(245, 158, 11, 0.16);
    border: 1px solid rgba(245, 158, 11, 0.45);
    color: #FCD34D;
    white-space: nowrap;
    flex-shrink: 0;
}

/* Tab spacing */
.stTabs [data-baseweb="tab-list"] {
    gap: 0.5rem;
}

.stTabs [data-baseweb="tab"] {
    border-radius: 8px 8px 0 0;
    padding: 0.55rem 1rem;
    font-weight: 600;
}
</style>
"""


def apply_custom_styles() -> None:
    """Inject SkillBridge dark-mode CSS styles into the active Streamlit page."""
    st.markdown(_CUSTOM_CSS, unsafe_allow_html=True)


def render_hero_header() -> None:
    """Render the top SkillBridge dark gradient hero banner."""
    st.markdown(
        """
        <div class="sb-hero">
            <div class="sb-hero-badge">Live Career Intelligence</div>
            <h1 class="sb-hero-title">SkillBridge &mdash; Live Skill-Gap &amp; Career Navigator</h1>
            <p class="sb-hero-subtitle">
                Connect your resume to live local job openings, rank missing skills by ROI
                (jobs unlocked), and simulate closing the gap in real time.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_skill_pills_html(skills: list[str], variant: str = "matched") -> str:
    """Return escaped inline HTML skill pill spans for matched, missing, or sim states."""
    if not skills:
        return ""
    css_class = _PILL_CLASS_BY_VARIANT.get(variant, "sb-pill")
    pills = "".join(
        f'<span class="{css_class}">{html.escape(skill)}</span>'
        for skill in skills
        if skill and skill.strip()
    )
    if not pills:
        return ""
    return f'<div class="sb-pills-wrap">{pills}</div>'
