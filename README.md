# SkillBridge — Live Skill-Gap & Career Navigator

**SkillBridge** bridges the gap between a candidate's resume and live local job market requirements—built with **HTML, CSS, Vanilla JavaScript, and a Node.js backend** (zero Python). It parses resumes (PDF upload, raw text paste, or 1-click demo personas), scans live Google Jobs postings via SerpApi, ranks missing technical skills by **ROI (jobs unlocked & marginal ready-today unlocks)**, lets users simulate closing gaps instantaneously with an interactive **"What-If" Skill Simulator**, pairs top gaps with YouTube tutorials + Google Search official documentation fallback + weekend proof-of-work mini-projects, and includes a **Career Toolkit** for Multi-Role Fit Comparison, Local vs. Remote Benchmarking, and ATS Resume Bullet Rewriting.

---

## Key Features

- **100% HTML / CSS / JavaScript Stack**: Semantic HTML5 + dark-mode CSS UI ([public/](file:///./public)) paired with a zero-framework Node.js HTTP server ([server.js](file:///./server.js)) and modular JS engine ([lib/](file:///./lib)).
- **Resume Parsing (3 Quick Presets, PDF Upload, or Paste Text)**: Extracts and normalizes text from uploaded PDF resumes via `pdf-parse`, accepts raw pasted resume text, or loads 1-click demo personas (`Frontend`, `Backend`, `Data Analyst`) from `data/sample_resumes.json`.
- **Hybrid Gemini + Regex Skill Normalization**: Uses Gemini Flash (`gemini-3.5-flash-lite` with `gemini-3.7-flash` / `gemini-3.8-flash` fallbacks) constrained strictly to canonical taxonomy keys in `data/skills_list.json` when `GEMINI_API_KEY` is configured, combined with word-boundary/lookaround regex matching (`C++`, `C#`, `.NET`, `Node.js`).
- **Live Market Demand & Concurrency-Safe Disk Cache**: Fetches real-time Google Jobs postings via SerpApi (`google_jobs`) with multi-page pagination support, request timeouts, optional TTL expiration, stale-while-offline fallback, and atomic concurrent temp-file writes under `data/cache/`.
- **Instant Client-Side "What-If" Skill Simulator**: Browser imports the shared `analyzeSkillGaps` module (`public/js/gap.js`) so toggling missing skills or clicking **Simulate Top 3** recalculates **Readiness Score**, marginal ready-job unlocks (`net_ready_unlocked`), charts, and tables in **0ms**.
- **YouTube + Google Search Learning Roadmap**: Queries SerpApi `engine=youtube` (`video_results` / `playlist_results`) with automatic fallback to SerpApi `engine=google` (`organic_results`) for official docs/tutorials, plus on-demand course loading (`POST /api/courses`) for gaps ranked #5+.
- **Career Toolkit (Stretch Goals Included)**:
  - **Multi-Role Fit Comparison**: Scores the candidate's resume across 3 adjacent roles (*Frontend Developer*, *Backend Python Developer*, *Data Analyst*) to surface the shortest path to employment.
  - **Local City vs. Remote Toggle**: Compares skill demand and readiness in the selected local city vs. Remote roles side by side.
  - **ATS Resume Bullet Rewriter**: Generates 3 STAR-format resume bullet points tailored to verified resume skills and high-demand scraped job keywords.

---

## Architecture

```text
server.js                       # Node.js HTTP server (static files + /api/presets, /api/analyze, /api/courses, /api/toolkit)
├── public/
│   ├── index.html              # Responsive dashboard shell (4 tabs + sidebar controls)
│   ├── styles.css              # Dark-mode SkillBridge theme & skill pill components
│   ├── app.js                  # Vanilla JS SPA state, chart renderer, simulator, job filters, toolkit, CSV export
│   └── js/
│       └── gap.js              # Shared ESM ROI gap ranker & What-If simulator (used by browser & server)
├── lib/
│   ├── env.js                  # .env loader (respects explicitly blanked env vars)
│   ├── cache.js                # Concurrency-safe SHA-256 JSON disk cache with TTL & stats under data/cache/
│   ├── jobs.js                 # SerpApi google_jobs client, pagination, timeouts, & stale fallback
│   ├── resumeParser.js         # pdf-parse PDF extractor & text normalizer
│   ├── skills.js               # Canonical Gemini + regex alias extractor & demand aggregator
│   ├── courses.js              # SerpApi YouTube + Google Search fallback fetcher & mini-project generator
│   ├── compare.js              # Multi-Role Fit, Local vs. Remote comparison, & ATS Bullet Rewriter
│   └── offlineDemo.js          # 0-credit deterministic offline job fixtures
├── data/
│   ├── skills_list.json        # 83 canonical technical skills & lowercase alias dictionary
│   ├── sample_resumes.json     # 3 demo personas (Frontend Student, Backend Python Dev, Data Analyst)
│   └── cache/                  # Pre-seeded SerpApi & Gemini JSON cache files
└── tests/
    └── test.mjs                # Node built-in test runner suite (node --test)
```

---

## Quickstart

### 1. Install dependencies (Node.js 20+)

```bash
npm install
```

### 2. Configure environment variables (optional for Offline Demo / Seeded Cache)

Copy `.env.example` to `.env` and add your keys if you want live SerpApi job/YouTube/Google lookups and Gemini extraction:

```env
SERPAPI_KEY=your_serpapi_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Launch SkillBridge

```bash
npm start
```

Open **http://localhost:3000** in your browser.

---

## Running Tests

Runs completely offline with 0 API credits via Node's built-in test runner:

```bash
npm test
```
