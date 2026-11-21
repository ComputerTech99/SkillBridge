# SkillBridge — Live Skill-Gap & Career Navigator

**SkillBridge** bridges the gap between a candidate's resume and live local job market requirements. It parses a resume (PDF or 1-click demo persona), scans live job openings, ranks missing technical skills by **ROI (number of jobs unlocked)**, lets users simulate closing gaps in real time with an interactive **"What-If" Skill Simulator**, and attaches targeted tutorials plus weekend proof-of-work mini-projects.

---

## Key Features

- **PDF & Preset Resume Parsing**: Extracts and normalizes text from uploaded PDF resumes via `pdfplumber` or loads 1-click demo personas from `data/sample_resumes.json`.
- **Hybrid LLM + Regex Skill Normalization**: Uses `gemini-2.5-flash` (`google-genai`) structured JSON output when `GEMINI_API_KEY` is configured, with an automatic regex word-boundary fallback against `data/skills_list.json` (including symbol-heavy skills like `C++`, `C#`, `.NET`, and `Node.js`).
- **Live Market Demand & Credit-Safe Disk Caching**: Fetches real-time Google Jobs postings via SerpApi (`google_jobs`) and caches responses deterministically under `data/cache/`.
- **Interactive "What-If" Skill Simulator**: Toggle any of the top 5 missing skills to watch your **Readiness Score (%)**, **Ready to Apply Today** job count, and job buckets update instantaneously.
- **Zero-Credit Offline Demo Mode**: Includes a deterministic **Load Offline Demo** flow so judges and reviewers can test the full dashboard without any API keys.
- **Two-Bucket Job Matching & Learning Roadmap**: Separates openings into **Ready to Apply Today** (`>=75%` match or `<=1` missing skill) and **Almost Ready — 2–3 Skills Away**, paired with YouTube learning resources and weekend proof-of-work mini-project prompts.

---

## Architecture

```text
app.py                          # Streamlit entrypoint wiring ui/* and src/*
├── ui/
│   ├── styles.py               # Dark-mode CSS theme, hero banner, skill pill helpers
│   ├── state.py                # Session state, live pipeline, & 0-credit offline demo dataset
│   ├── sidebar.py              # Persona/PDF input controls & live/offline analysis triggers
│   ├── simulator_panel.py      # KPI metrics header & What-If skill toggle simulator
│   └── jobs_and_roadmap.py     # Gap chart, learning roadmap, two-bucket job cards, demand table
├── src/
│   ├── schemas.py              # Pydantic v2 data contracts (JobPosting, SkillDemand, GapItem, AnalysisResult)
│   ├── cache.py                # SHA-256 deterministic JSON cache under data/cache/
│   ├── jobs.py                 # SerpApi google_jobs client & JobPosting parser
│   ├── resume_parser.py        # pdfplumber PDF extractor & text normalizer
│   ├── skills.py               # Hybrid Gemini + regex alias skill extractor & market demand aggregator
│   ├── gap.py                  # ROI gap ranking, readiness scoring, & What-If simulation engine
│   └── courses.py              # SerpApi YouTube course fetcher & mini-project generator
├── data/
│   ├── skills_list.json        # Canonical technical skills & alias dictionary
│   └── sample_resumes.json     # Demo personas (Frontend Student & Junior Backend Python Dev)
└── tests/
    ├── test_backend.py         # Offline end-to-end backend pipeline smoke tests
    └── test_app.py             # Streamlit AppTest UI wiring & SerpApi error-safety tests
```

---

## Quickstart

### 1. Create and activate a virtual environment

```bash
python -m venv venv
# Windows PowerShell
.\venv\Scripts\Activate.ps1
# macOS / Linux
source venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment variables (optional for Offline Demo)

Copy `.env.example` to `.env` and add your keys if you want live SerpApi job/YouTube lookups and Gemini extraction:

```env
SERPAPI_KEY=your_serpapi_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Run the app

```bash
streamlit run app.py
```

Click **Load Offline Demo** in the sidebar to run immediately with **0 API credits**, or click **Analyze Live Market** when your keys are configured.

---

## Running Tests

Both test suites run completely offline with 0 API credits:

```bash
python tests/test_backend.py
python tests/test_app.py
```
