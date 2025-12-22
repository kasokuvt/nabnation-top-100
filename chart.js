/* =========================
   CONFIG
========================= */

const PLACEHOLDER = "./covers/placeholder.png";
const DATA_DIR = "./data";

/* =========================
   HELPERS
========================= */

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanArtistName(name = "") {
  return name
    .replace(/\(.*?pts.*?\)/gi, "")
    .replace(/\(.*?listeners.*?\)/gi, "")
    .replace(/\*+/g, "")
    .trim();
}

function imgWithFallback(src) {
  return `
    <img
      src="${src || PLACEHOLDER}"
      onerror="this.onerror=null;this.src='${PLACEHOLDER}'"
      loading="lazy"
    >
  `;
}

/* =========================
   DATA LOAD
========================= */

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path);
  return r.json();
}

async function loadWeek(week) {
  return loadJSON(`${DATA_DIR}/${week}.json`);
}

async function loadHistory() {
  return loadJSON(`${DATA_DIR}/history.json`);
}

/* =========================
   STATS AS OF WEEK
========================= */

function computeStatsUpToWeek(songKey, history, currentWeek) {
  const entries = history
    .filter(e => e.key === songKey && e.week <= currentWeek)
    .sort((a, b) => a.week.localeCompare(b.week));

  if (!entries.length) return null;

  let peak = Infinity;
  entries.forEach(e => peak = Math.min(peak, e.rank));

  return {
    debut: entries[0].week,
    peak,
    weeks: entries.length
  };
}

function getLastWeekRank(songKey, history, currentWeek) {
  const prev = history.find(
    e => e.key === songKey && e.week < currentWeek
  );
  return prev ? prev.rank : null;
}

/* =========================
   MOVEMENT / BADGES
========================= */

function movementBadge(entry) {
  if (!entry.movement) return "";

  if (entry.movement.type === "new")
    return `<span class="badge new">NEW</span>`;

  if (entry.movement.type === "re")
    return `<span class="badge re">RE</span>`;

  if (entry.movement.value > 0)
    return `<span class="badge up">▲ ${entry.movement.value}</span>`;

  if (entry.movement.value < 0)
    return `<span class="badge down">▼ ${Math.abs(entry.movement.value)}</span>`;

  return `<span class="badge same">—</span>`;
}

/* =========================
   AWARDS
========================= */

function computeAwards(entries) {
  let biggestJump = null;
  let biggestFall = null;
  let hotShotDebut = null;
  let hotShotRe = null;
  let longest = null;

  for (const e of entries) {
    if (e.movement?.type === "new") {
      if (!hotShotDebut || e.rank < hotShotDebut.rank) hotShotDebut = e;
    }

    if (e.movement?.type === "re") {
      if (!hotShotRe || e.rank < hotShotRe.rank) hotShotRe = e;
    }

    if (typeof e.movement?.value === "number") {
      if (e.movement.value > 0) {
        if (!biggestJump || e.movement.value > biggestJump.movement.value)
          biggestJump = e;
      }
      if (e.movement.value < 0) {
        if (!biggestFall || e.movement.value < biggestFall.movement.value)
          biggestFall = e;
      }
    }

    if (!longest || e.weeks > longest.weeks) longest = e;
  }

  return { biggestJump, biggestFall, hotShotDebut, hotShotRe, longest };
}

/* =========================
   RENDER
========================= */

function renderAwards(entry, awards) {
  const lines = [];

  if (awards.biggestJump === entry)
    lines.push(`<span class="award jump">Biggest Jump (+${entry.movement.value})</span>`);

  if (awards.biggestFall === entry)
    lines.push(`<span class="award fall">Biggest Fall (${entry.movement.value})</span>`);

  if (awards.hotShotDebut === entry)
    lines.push(`<span class="award debut">Hot Shot Debut</span>`);

  if (awards.hotShotRe === entry)
    lines.push(`<span class="award re">Hot Shot Re-Entry</span>`);

  if (awards.longest === entry)
    lines.push(`<span class="award long">Longest Chart Sitter</span>`);

  return lines.join("<br>");
}

function renderRow(entry, stats, lastWeek, awards) {
  const lw = entry.movement?.type === "re" ? "—" : (lastWeek ?? "—");

  return `
    <div class="chart-row" data-key="${entry.key}">
      <div class="rank">
        ${entry.rank}
        ${movementBadge(entry)}
      </div>

      <div class="song">
        ${imgWithFallback(entry.cover)}
        <div class="meta">
          <div class="title">${escapeHtml(entry.title)}</div>
          <div class="artist">${escapeHtml(cleanArtistName(entry.artist))}</div>
          ${renderAwards(entry, awards)}
        </div>
      </div>

      <div class="stats">
        LW ${lw} &nbsp; Peak ${stats?.peak ?? entry.rank}
        &nbsp; Weeks ${stats?.weeks ?? 1}
      </div>
    </div>
  `;
}

/* =========================
   MAIN
========================= */

async function init() {
  const week = qs("week");
  if (!week) return;

  const weekData = await loadWeek(week);
  const history = await loadHistory();

  const awards = computeAwards(weekData.entries);

  const html = weekData.entries.map(e => {
    const stats = computeStatsUpToWeek(e.key, history, week);
    const lw = getLastWeekRank(e.key, history, week);
    return renderRow(e, stats, lw, awards);
  }).join("");

  document.querySelector("#chart").innerHTML = html;

  document.querySelectorAll(".chart-row").forEach(row => {
    row.addEventListener("click", () => {
      row.classList.toggle("open");
    });
  });
}

init();
