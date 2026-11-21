import { analyzeSkillGaps } from "/js/gap.js";

const state = {
  presets: [],
  cities: [],
  activeResult: null,
  toolkitData: null,
  simulatedSkills: new Set(),
  demandStatusFilter: "All",
  jobFilterQuery: "",
  onlyUnlocked: false,
  selectedPdfBase64: null,
};

const els = {
  quickStudentBtn: document.getElementById("quickStudentBtn"),
  quickBackendBtn: document.getElementById("quickBackendBtn"),
  quickAnalystBtn: document.getElementById("quickAnalystBtn"),
  sourceRadios: document.querySelectorAll('input[name="resumeSource"]'),
  presetPanel: document.getElementById("presetInputPanel"),
  pdfPanel: document.getElementById("pdfInputPanel"),
  pastePanel: document.getElementById("pasteInputPanel"),
  personaSelect: document.getElementById("personaSelect"),
  presetPreview: document.getElementById("presetPreview"),
  pdfFileInput: document.getElementById("pdfFileInput"),
  pdfFileName: document.getElementById("pdfFileName"),
  pastedResumeInput: document.getElementById("pastedResumeInput"),
  targetRoleInput: document.getElementById("targetRoleInput"),
  citySelect: document.getElementById("citySelect"),
  useCacheCheckbox: document.getElementById("useCacheCheckbox"),
  analyzeLiveBtn: document.getElementById("analyzeLiveBtn"),
  loadOfflineBtn: document.getElementById("loadOfflineBtn"),
  cacheStatsBadge: document.getElementById("cacheStatsBadge"),
  sidebarSkillsSection: document.getElementById("sidebarSkillsSection"),
  sidebarSkillsPills: document.getElementById("sidebarSkillsPills"),
  modeChip: document.getElementById("modeChip"),
  errorBanner: document.getElementById("errorBanner"),
  loadingBanner: document.getElementById("loadingBanner"),
  loadingText: document.getElementById("loadingText"),
  offlineNotice: document.getElementById("offlineNotice"),
  onboardingView: document.getElementById("onboardingView"),
  dashboardView: document.getElementById("dashboardView"),
  metricReadiness: document.getElementById("metricReadiness"),
  metricReadinessDelta: document.getElementById("metricReadinessDelta"),
  metricJobsScanned: document.getElementById("metricJobsScanned"),
  metricReadyCount: document.getElementById("metricReadyCount"),
  metricReadyDelta: document.getElementById("metricReadyDelta"),
  metricTopRoi: document.getElementById("metricTopRoi"),
  metricTopRoiSub: document.getElementById("metricTopRoiSub"),
  progressLabel: document.getElementById("progressLabel"),
  progressValue: document.getElementById("progressValue"),
  progressBase: document.getElementById("progressBase"),
  progressSim: document.getElementById("progressSim"),
  simulatorPanel: document.getElementById("simulatorPanel"),
  simTop3Btn: document.getElementById("simTop3Btn"),
  simResetBtn: document.getElementById("simResetBtn"),
  simulatorCheckboxes: document.getElementById("simulatorCheckboxes"),
  simActiveBanner: document.getElementById("simActiveBanner"),
  tabs: document.querySelectorAll(".sb-tab"),
  tabPanels: document.querySelectorAll(".sb-tab-panel"),
  gapChartContainer: document.getElementById("gapChartContainer"),
  snapshotMeta: document.getElementById("snapshotMeta"),
  snapshotMatched: document.getElementById("snapshotMatched"),
  snapshotSimGroup: document.getElementById("snapshotSimGroup"),
  snapshotSimulated: document.getElementById("snapshotSimulated"),
  snapshotMissing: document.getElementById("snapshotMissing"),
  learningRoadmap: document.getElementById("learningRoadmap"),
  jobFilterInput: document.getElementById("jobFilterInput"),
  onlyUnlockedWrap: document.getElementById("onlyUnlockedWrap"),
  onlyUnlockedToggle: document.getElementById("onlyUnlockedToggle"),
  readyBucketTitle: document.getElementById("readyBucketTitle"),
  almostBucketTitle: document.getElementById("almostBucketTitle"),
  readyJobsList: document.getElementById("readyJobsList"),
  almostJobsList: document.getElementById("almostJobsList"),
  filterBtns: document.querySelectorAll(".sb-filter-btn"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  rawDemandTbody: document.getElementById("rawDemandTbody"),
  atsBulletsList: document.getElementById("atsBulletsList"),
  copyBulletsBtn: document.getElementById("copyBulletsBtn"),
  runToolkitBtn: document.getElementById("runToolkitBtn"),
  toolkitResultsWrap: document.getElementById("toolkitResultsWrap"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function updateCacheBadge(cacheStats) {
  if (!cacheStats || typeof cacheStats.totalFiles !== "number") return;
  const kb = Math.round((cacheStats.totalBytes || 0) / 1024);
  els.cacheStatsBadge.textContent = `Cache DB: ${cacheStats.totalFiles} saved queries (${kb} KB)`;
}

function renderPillsHtml(skills, variant = "matched") {
  if (!skills || skills.length === 0) return "";
  const cls =
    variant === "missing"
      ? "sb-pill sb-pill-missing"
      : variant === "sim"
      ? "sb-pill sb-pill-sim"
      : "sb-pill sb-pill-matched";
  return skills.map((s) => `<span class="${cls}">${escapeHtml(s)}</span>`).join("");
}

function getSelectedSource() {
  for (const r of els.sourceRadios) {
    if (r.checked) return r.value;
  }
  return "preset";
}

function setSelectedSource(source) {
  for (const r of els.sourceRadios) {
    r.checked = r.value === source;
  }
  els.presetPanel.classList.toggle("hidden", source !== "preset");
  els.pdfPanel.classList.toggle("hidden", source !== "pdf");
  els.pastePanel.classList.toggle("hidden", source !== "paste");
}

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.toggle("hidden", !msg);
}

function setLoading(isLoading, message = "Scanning live job market & extracting skills...") {
  els.loadingText.textContent = message;
  els.loadingBanner.classList.toggle("hidden", !isLoading);
  els.analyzeLiveBtn.disabled = isLoading;
  els.loadOfflineBtn.disabled = isLoading;
  els.quickStudentBtn.disabled = isLoading;
  els.quickBackendBtn.disabled = isLoading;
  if (els.quickAnalystBtn) els.quickAnalystBtn.disabled = isLoading;
}

function applySelectedPreset(index) {
  const preset = state.presets[index];
  if (!preset) return;
  els.personaSelect.value = String(index);
  els.presetPreview.textContent = preset.text;
  els.targetRoleInput.value = preset.role;
  if (state.cities.includes(preset.city)) {
    els.citySelect.value = preset.city;
  }
}

async function runAnalysis(mode, overridePayload = null) {
  showError("");
  const loadingMsg =
    mode === "offline"
      ? "Loading offline demo snapshot..."
      : "Scanning live job market & extracting skills...";
  setLoading(true, loadingMsg);

  try {
    let payload;
    if (overridePayload) {
      payload = overridePayload;
    } else {
      const source = getSelectedSource();
      const role = els.targetRoleInput.value.trim();
      const location = els.citySelect.value;
      const useCache = els.useCacheCheckbox ? els.useCacheCheckbox.checked : true;
      payload = { mode, role, location, useCache };

      if (source === "preset") {
        const idx = Number(els.personaSelect.value || 0);
        payload.resumeText = state.presets[idx]?.text || "";
      } else if (source === "paste") {
        payload.resumeText = els.pastedResumeInput.value;
      } else if (source === "pdf") {
        if (!state.selectedPdfBase64) {
          throw new Error("Please upload a PDF resume or switch to 1-Click Sample Preset.");
        }
        payload.pdfBase64 = state.selectedPdfBase64;
      }
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    state.activeResult = data;
    state.toolkitData = null;
    state.simulatedSkills.clear();
    state.jobFilterQuery = "";
    state.onlyUnlocked = false;
    els.jobFilterInput.value = "";
    els.onlyUnlockedToggle.checked = false;
    updateCacheBadge(data.cacheStats);
    renderDashboard();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    setLoading(false);
  }
}

async function loadCoursesOnDemand(skill, buttonEl) {
  const data = state.activeResult;
  if (!data) return;
  buttonEl.disabled = true;
  buttonEl.textContent = "Loading tutorials...";
  try {
    const res = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill, role: data.role }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Failed to fetch courses");
    data.coursesBySkill[skill] = {
      ...(data.coursesBySkill[skill] || { skill }),
      courses: payload.courses || [],
      mini_project_idea: payload.mini_project_idea || "",
    };
    updateCacheBadge(payload.cacheStats);
    renderDashboard();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    buttonEl.disabled = false;
    buttonEl.textContent = "Load Courses & Mini-Project";
  }
}

async function runCareerToolkit() {
  const data = state.activeResult;
  if (!data) return;
  els.runToolkitBtn.disabled = true;
  els.runToolkitBtn.textContent = "Benchmarking 3 Roles & Remote...";

  try {
    const mode = data.analysisMode === "offline_demo" ? "offline" : "quick";
    const res = await fetch("/api/toolkit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeText: data.resumeText || "Python SQL JavaScript React Git",
        role: data.role,
        location: data.location,
        mode,
      }),
    });
    const toolkit = await res.json();
    if (!res.ok) throw new Error(toolkit.error || "Toolkit benchmark failed");
    state.toolkitData = toolkit;
    updateCacheBadge(toolkit.cacheStats);
    renderToolkitTab();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    els.runToolkitBtn.disabled = false;
    els.runToolkitBtn.textContent = "Refresh Benchmark";
  }
}

function renderDashboard() {
  const data = state.activeResult;
  if (!data) return;

  els.onboardingView.classList.add("hidden");
  els.dashboardView.classList.remove("hidden");

  const modeLabel = data.analysisMode === "offline_demo" ? "Offline Demo" : "Live Market";
  els.modeChip.textContent = `${data.role} · ${data.location} · ${modeLabel}`;
  els.modeChip.classList.remove("hidden");

  els.sidebarSkillsSection.classList.remove("hidden");
  els.sidebarSkillsPills.innerHTML =
    renderPillsHtml(data.userSkills, "matched") ||
    '<span class="sb-caption">No recognized technical skills detected yet.</span>';

  if (data.offlineDemoNotice) {
    els.offlineNotice.textContent = data.offlineDemoNotice;
    els.offlineNotice.classList.remove("hidden");
  } else {
    els.offlineNotice.classList.add("hidden");
  }

  const baseline = data.baseline;
  const selectedSim = [...state.simulatedSkills];
  const current = analyzeSkillGaps({
    role: data.role,
    location: data.location,
    userSkills: data.userSkills,
    jobs: data.jobs,
    demandList: data.demandList,
    simulatedSkills: selectedSim,
  });

  const readinessDelta = Math.round((current.readiness_score - baseline.readiness_score) * 10) / 10;
  const unlockedDelta = current.ready_jobs.length - baseline.ready_jobs.length;

  // Top KPI Metrics
  els.metricReadiness.textContent = `${current.readiness_score.toFixed(1)}%`;
  if (readinessDelta > 0) {
    els.metricReadinessDelta.textContent = `+${readinessDelta.toFixed(1)}% Readiness`;
    els.metricReadinessDelta.classList.remove("hidden");
  } else {
    els.metricReadinessDelta.classList.add("hidden");
  }

  els.metricJobsScanned.textContent = String(data.jobs.length);
  els.metricReadyCount.textContent = String(current.ready_jobs.length);
  if (unlockedDelta > 0) {
    els.metricReadyDelta.textContent = `+${unlockedDelta} Jobs Unlocked`;
    els.metricReadyDelta.classList.remove("hidden");
  } else {
    els.metricReadyDelta.classList.add("hidden");
  }

  const topGap = current.missing_gaps[0] || null;
  els.metricTopRoi.textContent = topGap ? topGap.skill : "All Covered";
  if (topGap) {
    els.metricTopRoiSub.textContent = `Unlocks ${topGap.jobs_unlocked}/${data.jobs.length} jobs`;
    els.metricTopRoiSub.classList.remove("hidden");
  } else {
    els.metricTopRoiSub.classList.add("hidden");
  }

  // Dual Progress Bar
  const basePct = Math.max(0, Math.min(100, baseline.readiness_score));
  const currPct = Math.max(basePct, Math.min(100, current.readiness_score));
  const boost = Math.round((currPct - basePct) * 10) / 10;
  els.progressLabel.textContent =
    boost > 0 ? `Market Readiness (+${boost.toFixed(1)}% simulated)` : "Market Readiness";
  els.progressValue.textContent = `${currPct.toFixed(1)}%`;
  els.progressBase.style.width = `${basePct.toFixed(1)}%`;
  els.progressSim.style.left = `${basePct.toFixed(1)}%`;
  els.progressSim.style.width = `${boost.toFixed(1)}%`;

  // Simulator Checkboxes
  const top5 = baseline.missing_gaps.slice(0, 5);
  els.simulatorPanel.classList.toggle("hidden", top5.length === 0);
  els.simResetBtn.disabled = selectedSim.length === 0;
  els.simulatorCheckboxes.innerHTML = top5
    .map((gap) => {
      const checked = state.simulatedSkills.has(gap.skill);
      const readyHint =
        gap.net_ready_unlocked > 0 ? ` · +${gap.net_ready_unlocked} ready now` : "";
      return `
        <label class="sb-sim-option ${checked ? "active" : ""}" title="Present in ${gap.demand_pct.toFixed(0)}% of scanned openings${readyHint}">
          <input type="checkbox" data-sim-skill="${escapeHtml(gap.skill)}" ${checked ? "checked" : ""} />
          <span>${escapeHtml(gap.skill)} (+${gap.jobs_unlocked}${readyHint})</span>
        </label>
      `;
    })
    .join("");

  els.simulatorCheckboxes.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener("change", (ev) => {
      const skill = ev.target.getAttribute("data-sim-skill");
      if (ev.target.checked) state.simulatedSkills.add(skill);
      else state.simulatedSkills.delete(skill);
      renderDashboard();
    });
  });

  if (selectedSim.length > 0) {
    els.simActiveBanner.innerHTML = `<strong>Simulation Active (${escapeHtml(selectedSim.join(", "))}):</strong> +${readinessDelta.toFixed(1)}% Readiness · +${unlockedDelta} Jobs Unlocked · ${current.missing_gaps.length} Remaining Gaps`;
    els.simActiveBanner.classList.remove("hidden");
  } else {
    els.simActiveBanner.classList.add("hidden");
  }

  renderGapsTab(data, current, selectedSim);
  renderJobsTab(data, current, selectedSim);
  renderRawDemandTab(data, selectedSim);
  renderToolkitTab();
}

function renderGapsTab(data, current, selectedSim) {
  const topGaps = current.missing_gaps.slice(0, 12);
  if (topGaps.length === 0) {
    els.gapChartContainer.innerHTML =
      '<div class="sb-alert sb-alert-success">All tracked market skill gaps are covered!</div>';
  } else {
    const maxUnlocked = Math.max(...topGaps.map((g) => g.jobs_unlocked), 1);
    els.gapChartContainer.innerHTML = topGaps
      .map((gap) => {
        const widthPct = Math.round((gap.jobs_unlocked / maxUnlocked) * 100);
        return `
          <div class="sb-chart-row" title="${escapeHtml(gap.skill)}: ${gap.jobs_unlocked} jobs (${gap.demand_pct.toFixed(1)}% demand)">
            <div class="sb-chart-skill">${escapeHtml(gap.skill)}</div>
            <div class="sb-chart-track">
              <div class="sb-chart-bar" style="width: ${widthPct}%"></div>
            </div>
            <div class="sb-chart-val">${gap.jobs_unlocked} job${gap.jobs_unlocked === 1 ? "" : "s"}</div>
          </div>
        `;
      })
      .join("");
  }

  const demandSkillSet = new Set(data.demandList.map((d) => d.skill));
  const coveredCount = current.matched_skills.filter((s) => demandSkillSet.has(s)).length;
  els.snapshotMeta.innerHTML = `Target: <strong>${escapeHtml(current.role)}</strong> · <strong>${escapeHtml(current.location)}</strong> · Covering <strong>${coveredCount}/${demandSkillSet.size}</strong> tracked market skills`;

  const simSet = new Set(selectedSim);
  let matchedResume = current.matched_skills.filter((s) => !simSet.has(s));
  if (matchedResume.length === 0 && data.userSkills.length > 0) {
    matchedResume = data.userSkills.filter((s) => !simSet.has(s));
  }
  els.snapshotMatched.innerHTML =
    renderPillsHtml(matchedResume, "matched") ||
    '<span class="sb-caption">No resume skills matched the scanned postings yet.</span>';

  els.snapshotSimGroup.classList.toggle("hidden", selectedSim.length === 0);
  els.snapshotSimulated.innerHTML = renderPillsHtml(selectedSim, "sim");

  const remainingTop = current.missing_gaps.slice(0, 10).map((g) => g.skill);
  els.snapshotMissing.innerHTML =
    renderPillsHtml(remainingTop, "missing") ||
    '<span class="sb-caption">No remaining skill gaps.</span>';

  // Learning Roadmap
  if (current.missing_gaps.length === 0) {
    els.learningRoadmap.innerHTML =
      '<div class="sb-alert sb-alert-success">No learning gaps left — you are ready to apply to the matched roles!</div>';
    return;
  }

  els.learningRoadmap.innerHTML = current.missing_gaps
    .map((gap) => {
      const cached = data.coursesBySkill[gap.skill] || gap;
      const projectHtml = cached.mini_project_idea
        ? `<div class="sb-alert sb-alert-info"><div><strong>Weekend Proof-of-Work Mini-Project:</strong> ${escapeHtml(cached.mini_project_idea)}</div></div>`
        : "";

      let coursesHtml = "";
      if (cached.courses && cached.courses.length > 0) {
        coursesHtml = `<div class="sb-courses-grid">${cached.courses
          .map((course) => {
            const thumb = course.thumbnail
              ? `<img class="sb-course-thumb" src="${escapeHtml(course.thumbnail)}" alt="${escapeHtml(course.title)}" loading="lazy" />`
              : "";
            const meta = [course.channel_or_site, course.source, course.duration]
              .filter(Boolean)
              .map(escapeHtml)
              .join(" · ");
            const ctaText =
              course.source === "Google Search" ? "Open Official Guide" : "Watch Tutorial";
            return `
              <div class="sb-course-card">
                ${thumb}
                <a class="sb-course-title" href="${escapeHtml(course.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(course.title)}</a>
                <div class="sb-caption">${meta}</div>
                <a class="sb-btn sb-btn-secondary sb-btn-sm" href="${escapeHtml(course.url)}" target="_blank" rel="noopener noreferrer">${ctaText}</a>
              </div>
            `;
          })
          .join("")}</div>`;
      } else {
        coursesHtml = `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.6rem;">
            <span class="sb-caption">Tutorials for this skill were not preloaded yet.</span>
            <button class="sb-btn sb-btn-secondary sb-btn-sm" data-load-course="${escapeHtml(gap.skill)}" type="button">
              Load Courses &amp; Docs
            </button>
          </div>
        `;
      }

      const marginalTag =
        gap.net_ready_unlocked > 0
          ? ` · Flips +${gap.net_ready_unlocked} job${gap.net_ready_unlocked === 1 ? "" : "s"} to Ready Today`
          : "";

      return `
        <details class="sb-expander" ${gap.priority_rank === 1 ? "open" : ""}>
          <summary>#${gap.priority_rank} ${escapeHtml(gap.skill)} — Required in ${gap.jobs_unlocked} job${gap.jobs_unlocked === 1 ? "" : "s"} (${gap.demand_pct.toFixed(1)}% demand${marginalTag})</summary>
          <div class="sb-expander-body">
            ${projectHtml}
            ${coursesHtml}
          </div>
        </details>
      `;
    })
    .join("");

  els.learningRoadmap.querySelectorAll("[data-load-course]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const skill = btn.getAttribute("data-load-course");
      loadCoursesOnDemand(skill, btn);
    });
  });
}

function renderJobCardHtml(job, effectiveSet, simSet, isReady, newlyUnlocked) {
  const matchedResume = (job.extracted_skills || []).filter(
    (s) => effectiveSet.has(s) && !simSet.has(s)
  );
  const matchedSim = (job.extracted_skills || []).filter((s) => simSet.has(s));
  const missing = (job.extracted_skills || []).filter((s) => !effectiveSet.has(s));

  const badgeHtml = isReady
    ? '<span class="sb-badge-ready">Ready to Apply</span>'
    : `<span class="sb-badge-almost">${missing.length} Skill${missing.length === 1 ? "" : "s"} Away</span>`;
  const unlockedHtml = newlyUnlocked
    ? '<span class="sb-badge-unlocked">Unlocked by What-If</span>'
    : "";
  const salaryHtml = job.salary_text ? ` · ${escapeHtml(job.salary_text)}` : "";
  const remoteHtml = job.work_from_home ? " · Remote" : "";

  const qualsList = (job.qualifications || []).slice(0, 5);
  const snippet = (job.description || "").trim();
  const shortDesc = snippet.length > 360 ? `${snippet.slice(0, 357).trim()}...` : snippet;

  return `
    <article class="sb-job-card">
      <div class="sb-job-head">
        <div>
          <div class="sb-job-title">${escapeHtml(job.title)}</div>
          <div class="sb-job-meta">${escapeHtml(job.company)} · ${escapeHtml(job.location)}${remoteHtml}${salaryHtml}</div>
        </div>
        <div class="sb-badge-group">${unlockedHtml}${badgeHtml}</div>
      </div>
      ${matchedResume.length ? `<div class="sb-job-label">Matched Skills</div><div class="sb-pills-wrap">${renderPillsHtml(matchedResume, "matched")}</div>` : ""}
      ${matchedSim.length ? `<div class="sb-job-label">Simulated Skills</div><div class="sb-pills-wrap">${renderPillsHtml(matchedSim, "sim")}</div>` : ""}
      ${missing.length ? `<div class="sb-job-label">Missing Skills</div><div class="sb-pills-wrap">${renderPillsHtml(missing, "missing")}</div>` : ""}
      ${
        qualsList.length || shortDesc
          ? `<details class="sb-details"><summary>View Qualifications &amp; Summary</summary>${
              qualsList.length
                ? `<ul class="sb-job-quals">${qualsList.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ul>`
                : ""
            }${shortDesc ? `<p class="sb-caption">${escapeHtml(shortDesc)}</p>` : ""}</details>`
          : ""
      }
      ${
        job.apply_url
          ? `<a class="sb-btn sb-btn-primary sb-btn-sm" href="${escapeHtml(job.apply_url)}" target="_blank" rel="noopener noreferrer">Apply Now</a>`
          : ""
      }
    </article>
  `;
}

function renderJobsTab(data, current, selectedSim) {
  const effectiveSet = new Set([...data.userSkills, ...selectedSim]);
  const simSet = new Set(selectedSim);
  const baselineReadyIds = new Set(data.baseline.ready_jobs.map((j) => j.job_id));
  const query = state.jobFilterQuery.trim().toLowerCase();

  els.onlyUnlockedWrap.classList.toggle("hidden", selectedSim.length === 0);

  const matchesFilter = (job) => {
    if (!query) return true;
    const hay = [job.title, job.company, job.location, ...(job.extracted_skills || [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  };

  const readyFiltered = current.ready_jobs.filter(
    (job) =>
      matchesFilter(job) &&
      (!state.onlyUnlocked || !baselineReadyIds.has(job.job_id))
  );
  const almostFiltered = current.almost_ready_jobs.filter(
    (job) => !state.onlyUnlocked && matchesFilter(job)
  );

  els.readyBucketTitle.textContent = `Ready to Apply Today (${readyFiltered.length})`;
  els.almostBucketTitle.textContent = `Almost Ready — 2–3 Skills Away (${almostFiltered.length})`;

  els.readyJobsList.innerHTML = readyFiltered.length
    ? readyFiltered
        .map((job) =>
          renderJobCardHtml(
            job,
            effectiveSet,
            simSet,
            true,
            selectedSim.length > 0 && !baselineReadyIds.has(job.job_id)
          )
        )
        .join("")
    : '<div class="sb-alert sb-alert-info">No postings match the current filter or &gt;=75% threshold.</div>';

  els.almostJobsList.innerHTML = almostFiltered.length
    ? almostFiltered
        .map((job) => renderJobCardHtml(job, effectiveSet, simSet, false, false))
        .join("")
    : '<div class="sb-alert sb-alert-info">No postings currently match this bucket.</div>';
}

function renderRawDemandTab(data, selectedSim) {
  const userSet = new Set(data.userSkills);
  const simSet = new Set(selectedSim);

  const rows = data.demandList
    .map((item) => {
      const status = userSet.has(item.skill)
        ? "Matched"
        : simSet.has(item.skill)
        ? "Simulated"
        : "Missing";
      return { ...item, status };
    })
    .filter(
      (row) => state.demandStatusFilter === "All" || row.status === state.demandStatusFilter
    );

  if (rows.length === 0) {
    els.rawDemandTbody.innerHTML =
      '<tr><td colspan="5" class="sb-caption">No skills match the selected status filter.</td></tr>';
    return;
  }

  els.rawDemandTbody.innerHTML = rows
    .map((row) => {
      const pillVariant =
        row.status === "Matched"
          ? "matched"
          : row.status === "Simulated"
          ? "sim"
          : "missing";
      const pct = Math.min(100, Math.round(row.demand_pct * 10) / 10);
      return `
        <tr>
          <td><strong>${escapeHtml(row.skill)}</strong></td>
          <td>${renderPillsHtml([row.status], pillVariant)}</td>
          <td>${row.job_count}</td>
          <td>${row.total_jobs}</td>
          <td>
            <div class="sb-demand-cell">
              <div class="sb-demand-bar-bg">
                <div class="sb-demand-bar-fill" style="width: ${pct}%"></div>
              </div>
              <span>${pct.toFixed(1)}%</span>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderToolkitTab() {
  const data = state.activeResult;
  if (!data) return;

  const bullets = Array.isArray(data.atsBullets) ? data.atsBullets : [];
  els.atsBulletsList.innerHTML = bullets.length
    ? bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")
    : '<li class="sb-caption">Run a scan to generate tailored ATS resume bullets.</li>';

  if (!state.toolkitData) {
    els.toolkitResultsWrap.innerHTML =
      '<div class="sb-caption">Click <strong>Run Multi-Role &amp; Remote Benchmark</strong> above to compare your resume against <em>Frontend Developer</em>, <em>Backend Python Developer</em>, and <em>Data Analyst</em> plus <em>Local vs. Remote</em> demand.</div>';
    return;
  }

  const { multiRole, localVsRemote } = state.toolkitData;
  const evals = multiRole?.evaluations || [];
  const bestRole = multiRole?.best_fit_role;

  const rolesHtml = `
    <h4 class="sb-snapshot-label">Multi-Role Fit Comparison (Shortest Path to Employment)</h4>
    <div class="sb-role-grid">
      ${evals
        .map((ev) => {
          const isBest = ev.role === bestRole;
          const badge = isBest
            ? '<span class="sb-badge-ready">Best Fit / Shortest Path</span>'
            : '<span class="sb-badge-almost">Adjacent Track</span>';
          const gaps = (ev.top_gaps || []).map((g) => g.skill);
          return `
            <div class="sb-role-card ${isBest ? "best-fit" : ""}">
              <div class="sb-job-head">
                <strong>${escapeHtml(ev.role)}</strong>
                ${badge}
              </div>
              <div class="sb-metric-value">${ev.readiness_score.toFixed(1)}%</div>
              <div class="sb-caption">Ready Today: <strong>${ev.ready_jobs_count}/${ev.jobs_scanned}</strong> · Almost Ready: <strong>${ev.almost_ready_count}</strong></div>
              <div class="sb-job-label">Top Missing Skills</div>
              <div class="sb-pills-wrap">${renderPillsHtml(gaps, "missing") || '<span class="sb-caption">None</span>'}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  const loc = localVsRemote?.local;
  const rem = localVsRemote?.remote;
  const locVsRemHtml =
    loc && rem
      ? `
    <h4 class="sb-snapshot-label">Local City vs. Remote Market Demand (${escapeHtml(data.role)})</h4>
    <div class="sb-loc-grid">
      <div class="sb-role-card">
        <div class="sb-job-head">
          <strong>Local: ${escapeHtml(loc.location)}</strong>
          <span class="sb-badge-unlocked">Readiness: ${loc.readiness_score.toFixed(1)}%</span>
        </div>
        <div class="sb-caption">Ready Jobs: <strong>${loc.ready_jobs_count}</strong> · #1 Gap: <strong>${escapeHtml(loc.top_gap)}</strong></div>
        <div class="sb-job-label">Top Demanded Local Skills</div>
        <div class="sb-pills-wrap">${renderPillsHtml(
          (loc.top_skills || []).map((s) => `${s.skill} (${s.demand_pct.toFixed(0)}%)`),
          "sim"
        )}</div>
      </div>
      <div class="sb-role-card">
        <div class="sb-job-head">
          <strong>Remote Openings</strong>
          <span class="sb-badge-unlocked">Readiness: ${rem.readiness_score.toFixed(1)}%</span>
        </div>
        <div class="sb-caption">Ready Jobs: <strong>${rem.ready_jobs_count}</strong> · #1 Gap: <strong>${escapeHtml(rem.top_gap)}</strong></div>
        <div class="sb-job-label">Top Demanded Remote Skills</div>
        <div class="sb-pills-wrap">${renderPillsHtml(
          (rem.top_skills || []).map((s) => `${s.skill} (${s.demand_pct.toFixed(0)}%)`),
          "sim"
        )}</div>
      </div>
    </div>
  `
      : "";

  els.toolkitResultsWrap.innerHTML = rolesHtml + locVsRemHtml;
}

function downloadDemandCsv() {
  const data = state.activeResult;
  if (!data) return;
  const userSet = new Set(data.userSkills);
  const simSet = state.simulatedSkills;

  const lines = ["Skill,Your Status,Jobs Requiring Skill,Total Jobs Scanned,Market Demand (%)"];
  for (const item of data.demandList) {
    const status = userSet.has(item.skill)
      ? "Matched"
      : simSet.has(item.skill)
      ? "Simulated"
      : "Missing";
    const escapedSkill = `"${String(item.skill).replace(/"/g, '""')}"`;
    lines.push(
      `${escapedSkill},${status},${item.job_count},${item.total_jobs},${item.demand_pct.toFixed(1)}`
    );
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = data.role.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "skillbridge";
  a.download = `skillbridge_demand_${slug}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const res = await fetch("/api/presets");
  const { presets, cities, cache } = await res.json();
  state.presets = presets;
  state.cities = cities;
  updateCacheBadge(cache);

  els.personaSelect.innerHTML = presets
    .map((p, idx) => `<option value="${idx}">${escapeHtml(p.label)}</option>`)
    .join("");
  els.citySelect.innerHTML = cities
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
    .join("");
  applySelectedPreset(0);

  els.sourceRadios.forEach((radio) => {
    radio.addEventListener("change", () => setSelectedSource(getSelectedSource()));
  });

  els.personaSelect.addEventListener("change", (ev) => {
    applySelectedPreset(Number(ev.target.value));
  });

  els.pdfFileInput.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) {
      state.selectedPdfBase64 = null;
      els.pdfFileName.textContent = "No file chosen";
      return;
    }
    els.pdfFileName.textContent = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      state.selectedPdfBase64 = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });

  const triggerQuickPreset = (idx) => {
    setSelectedSource("preset");
    const safeIdx = idx < state.presets.length ? idx : 0;
    applySelectedPreset(safeIdx);
    const p = state.presets[safeIdx];
    runAnalysis("quick", { mode: "quick", role: p.role, location: p.city, resumeText: p.text });
  };

  els.quickStudentBtn.addEventListener("click", () => triggerQuickPreset(0));
  els.quickBackendBtn.addEventListener("click", () => triggerQuickPreset(1));
  if (els.quickAnalystBtn) {
    els.quickAnalystBtn.addEventListener("click", () => triggerQuickPreset(2));
  }

  els.analyzeLiveBtn.addEventListener("click", () => runAnalysis("live"));
  els.loadOfflineBtn.addEventListener("click", () => runAnalysis("offline"));

  els.simTop3Btn.addEventListener("click", () => {
    const top3 = state.activeResult?.baseline?.missing_gaps?.slice(0, 3) || [];
    state.simulatedSkills = new Set(top3.map((g) => g.skill));
    renderDashboard();
  });

  els.simResetBtn.addEventListener("click", () => {
    state.simulatedSkills.clear();
    renderDashboard();
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.getAttribute("data-tab");
      els.tabs.forEach((t) => {
        const isTarget = t === tab;
        t.classList.toggle("active", isTarget);
        t.setAttribute("aria-selected", String(isTarget));
      });
      els.tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${target}`);
      });
    });
  });

  els.jobFilterInput.addEventListener("input", (ev) => {
    state.jobFilterQuery = ev.target.value;
    if (state.activeResult) renderDashboard();
  });

  els.onlyUnlockedToggle.addEventListener("change", (ev) => {
    state.onlyUnlocked = ev.target.checked;
    if (state.activeResult) renderDashboard();
  });

  els.filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.demandStatusFilter = btn.getAttribute("data-status") || "All";
      els.filterBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (state.activeResult) renderDashboard();
    });
  });

  els.downloadCsvBtn.addEventListener("click", downloadDemandCsv);
  els.runToolkitBtn.addEventListener("click", runCareerToolkit);
  els.copyBulletsBtn.addEventListener("click", async () => {
    const bullets = state.activeResult?.atsBullets || [];
    if (!bullets.length) return;
    try {
      await navigator.clipboard.writeText(bullets.map((b) => `• ${b}`).join("\n"));
      els.copyBulletsBtn.textContent = "Copied!";
      setTimeout(() => {
        els.copyBulletsBtn.textContent = "Copy Bullets";
      }, 1500);
    } catch {
      // Clipboard API may be blocked in non-HTTPS contexts
    }
  });
}

init().catch((err) => showError(err instanceof Error ? err.message : String(err)));
