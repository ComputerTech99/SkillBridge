"""Sidebar profile inputs, resume preset/PDF handling, and analysis triggers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import streamlit as st

from src.resume_parser import extract_text_from_pdf
from ui.state import (
    CITY_OPTIONS,
    load_sample_resumes,
    run_market_analysis,
    run_offline_demo_snapshot,
)
from ui.styles import render_skill_pills_html

_INPUT_MODE_PRESET = "1-Click Sample Preset"
_INPUT_MODE_PDF = "Upload Resume PDF"


def _resolve_resume_text(
    input_mode: str,
    selected_preset_text: str,
    uploaded_pdf: Any,
) -> str:
    """Resolve and validate resume text from a sample preset or uploaded PDF."""
    if input_mode == _INPUT_MODE_PRESET:
        if not selected_preset_text or not selected_preset_text.strip():
            raise ValueError("Selected sample preset has no readable resume text.")
        return selected_preset_text

    if uploaded_pdf is None:
        raise ValueError("Please upload a PDF resume or switch to 1-Click Sample Preset.")

    pdf_source = uploaded_pdf.getvalue() if hasattr(uploaded_pdf, "getvalue") else uploaded_pdf
    return extract_text_from_pdf(pdf_source)


def _execute_analysis(
    runner: Callable[[str, str, str], None],
    spinner_text: str,
    input_mode: str,
    selected_preset_text: str,
    uploaded_pdf: Any,
    target_role: str,
    selected_city: str,
) -> None:
    """Validate inputs, resolve resume text, and run the chosen analysis pipeline."""
    st.session_state["last_error"] = None
    try:
        if not target_role:
            raise ValueError("Please enter a Target Role.")
        resume_text = _resolve_resume_text(
            input_mode=input_mode,
            selected_preset_text=selected_preset_text,
            uploaded_pdf=uploaded_pdf,
        )
        with st.spinner(spinner_text):
            runner(resume_text, target_role, selected_city)
    except Exception as exc:
        st.session_state["last_error"] = str(exc)


def render_sidebar() -> None:
    """Render the SkillBridge sidebar controls and extracted resume skills summary."""
    with st.sidebar:
        st.header("Your Profile & Target Market")

        presets = load_sample_resumes()
        preset_map = {item["label"]: item for item in presets}

        input_mode = st.radio(
            "Resume Input",
            options=[_INPUT_MODE_PRESET, _INPUT_MODE_PDF],
            key="resume_input_mode",
        )

        selected_preset_text = ""
        uploaded_pdf: Any = None

        if input_mode == _INPUT_MODE_PRESET:
            selected_label = st.selectbox(
                "Choose a Demo Persona",
                options=list(preset_map.keys()),
                key="demo_persona_select",
            )
            selected = preset_map[selected_label]
            if st.session_state.get("_last_preset") != selected_label:
                st.session_state["_last_preset"] = selected_label
                st.session_state["target_role_input"] = selected["role"]
                if selected["city"] in CITY_OPTIONS:
                    st.session_state["selected_city_input"] = selected["city"]

            selected_preset_text = selected["text"]
            with st.expander("Preview Sample Resume"):
                st.text(selected_preset_text)
        else:
            uploaded_pdf = st.file_uploader(
                "Upload Resume (PDF)",
                type=["pdf"],
                key="resume_pdf_uploader",
            )

        if "target_role_input" not in st.session_state:
            st.session_state["target_role_input"] = (
                presets[0]["role"] if presets else "Backend Python Developer"
            )
        if (
            "selected_city_input" not in st.session_state
            or st.session_state["selected_city_input"] not in CITY_OPTIONS
        ):
            st.session_state["selected_city_input"] = CITY_OPTIONS[0]

        target_role = st.text_input("Target Role", key="target_role_input").strip()
        selected_city = st.selectbox(
            "City / Market",
            options=CITY_OPTIONS,
            key="selected_city_input",
        )

        analyze_clicked = st.button(
            "Analyze Live Market",
            type="primary",
            width="stretch",
            key="analyze_live_btn",
        )
        offline_clicked = st.button(
            "Load Offline Demo",
            type="secondary",
            width="stretch",
            key="run_offline_demo_btn",
            help="Run a deterministic 0-credit local demo snapshot without calling SerpApi or Gemini.",
        )

        if analyze_clicked:
            _execute_analysis(
                runner=run_market_analysis,
                spinner_text="Scanning live job market & extracting skills...",
                input_mode=input_mode,
                selected_preset_text=selected_preset_text,
                uploaded_pdf=uploaded_pdf,
                target_role=target_role,
                selected_city=selected_city,
            )
        elif offline_clicked:
            _execute_analysis(
                runner=run_offline_demo_snapshot,
                spinner_text="Loading offline demo snapshot...",
                input_mode=input_mode,
                selected_preset_text=selected_preset_text,
                uploaded_pdf=uploaded_pdf,
                target_role=target_role,
                selected_city=selected_city,
            )

        if st.session_state.get("has_analyzed"):
            st.divider()
            st.subheader("Extracted Resume Skills")
            user_skills: list[str] = st.session_state.get("user_skills", [])
            pills_html = render_skill_pills_html(user_skills, variant="matched")
            if pills_html:
                st.markdown(pills_html, unsafe_allow_html=True)
            else:
                st.caption("No recognized technical skills detected yet.")
