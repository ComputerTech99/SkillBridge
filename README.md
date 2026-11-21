# SkillBridge — Live Skill-Gap & Career Navigator

**SkillBridge** bridges the gap between a candidate's resume and live local job market requirements—built with **HTML, CSS, Vanilla JavaScript, and a Node.js backend** (zero Python). It parses resumes (PDF upload, raw text paste, or 1-click demo personas), scans live Google Jobs postings via SerpApi, ranks missing technical skills by **ROI (jobs unlocked)**, lets users simulate closing gaps instantaneously with an interactive **"What-If" Skill Simulator**, and pairs top gaps with YouTube tutorials and weekend proof-of-work mini-projects.

---

## Key Features

- **100% HTML / CSS / JavaScript Stack**: Clean semantic HTML5 + dark-mode CSS UI ([public/](file:///./public)) paired with a zero-framework Node.js HTTP server ([server.js](file:///./server.js)) and modular JS engine ([lib/](file:///./lib)).
- **Resume Parsing (Preset, PDF, or Paste)**: Extracts and normalizes text from uploaded PDF resumes via `pdf-parse`, accepts raw pasted resume text, or loads 1-click demo personas from `data/sample_resumes.json`.
- **Hybrid Gemini + Regex Skill Normalization**: Uses Gemini Flash (`gemini-3.5-flash-lite` with `gemini-3.7-flash` / `gemini-3.8-flash` fallbacks) via REST API when `GEMINI_API_KEY` is configured, with automatic word-boundary/lookaround regex fallback against `data/skills_list.json` (including `C++`, `C#`, `.NET`, `Node.js`).
- **Live Market Demand & SHA-256 Disk Caching**: Fetches real-time Google Jobs postings via SerpApi (`google_jobs`) and caches responses deterministically under `data/cache/`.
- **Instant Client-Side "What-If" Skill Simulator**: Browser imports the shared `analyzeSkillGaps` module (`public/js/gap.js`) so toggling missing skills or clicking **Simulate Top 3** recalculates **Readiness Score**, unlocked jobs, charts, and tables in **0ms** with zero duplicate API calls.
- **Two-Bucket Job Board & CSV Export**: Splits openings into **Ready to Apply Today** vs. **Almost Ready — 2–3 Skills Away**, with live keyword filtering, `Only What-If Unlocked` toggle, YouTube tutorial cards, and 1-click CSV export.

---

## Architecture

```text
server.js                       # Node.js HTTP server (static files + /api/presets, /api/analyze)
├── public/
│   ├── index.html              # Responsive dashboard shell
│   ├── styles.css              # Dark-mode SkillBridge theme & skill pill components
│   ├── app.js                  # Vanilla JS SPA state, chart renderer, simulator, job filters, CSV export
│   └── js/
│       └── gap.js              # Shared ESM ROI gap ranker & What-If simulator (used by browser & server)
├── lib/
│   ├── env.js                  # .env loader
│   ├── cache.js                # SHA-256 JSON disk cache under data/cache/
│   ├── jobs.js                 # SerpApi google_jobs client & parser
│   ├── resumeParser.js         # pdf-parse PDF extractor & text normalizer
│   ├── skills.js               # Hybrid Gemini + regex alias extractor & demand aggregator
│   ├── courses.js              # SerpApi YouTube course fetcher & mini-project generator
│   └── offlineDemo.js          # 0-credit deterministic offline job fixtures
├── data/
│   ├── skills_list.json        # 83 canonical technical skills & lowercase alias dictionary
│   ├── sample_resumes.json     # Demo personas (CS Student Frontend & Junior Backend Python Dev)
│   └── cache/                  # 47 pre-seeded SerpApi & Gemini JSON cache files
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

Copy `.env.example` to `.env` and add your keys if you want live SerpApi job/YouTube lookups and Gemini extraction:

```env
SERPAPI_KEY=your_serpapi_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Launch SkillBridge

```bash
npm start
```

Open **http://localhost:3000** in your browser. Click **Frontend** or **Backend** under **Quick Demo Presets** for a 1-click walkthrough, **Load Offline Demo** for a 0-credit deterministic snapshot, or **Analyze Live Market** to scan live postings.

---

## Running Tests

Runs completely offline with 0 API credits via Node's built-in test runner:

```bash
npm test
```

---

## Deployment (Node.js Hosting: Render / Railway / Fly.io)

1. Ensure `.env` and `node_modules/` stay in `.gitignore`, while `data/cache/*.json` remains committed as a Wi-Fi-proof fallback.
2. Push to GitHub (`git push origin main`).
3. Create a Web Service with:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:** `SERPAPI_KEY` and `GEMINI_API_KEY`
