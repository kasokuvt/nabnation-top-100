/* =========================
   Nabnation Top 100 — chart.js
   Fixes:
   - song/artist to the RIGHT of cover (matches styles.css: .songRow/.song/.titleline/.artist)
   - stats are "as-of" selected week (not today)
   - re-entry LW shows — (not previous position)
   - artist name junk removed (pts/listeners/*)
   - placeholder cover fallback works on GitHub Pages
   - awards inline under artist
   - click row to expand/collapse (history)
========================= */

const COVER_FALLBACKS = [
  "./covers/_placeholder.png",
  "./covers/placeholder.png",
  "./assets/icon.webp",
];

const DATA = {
  manifest: "./data/manifest.json",
  latest: "./data/latest.json",
  catalog: "./data/catalog.json",
  weekFile: (week) => `./data/${week}.json`,
};

/* -------------------------
   Utilities
------------------------- */
function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function setQueryParam(key, value) {
  const u = new URL(location.href);
  if (value == null || value === "") u.searchParams.delete(key);
  else u.searchParams.set(key, value);
  location.href = u.toString();
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
  return String(name)
    .replace(/\([^)]*?\bpts\b[^)]*?\)/gi, "")
    .replace(/\([^)]*?\blisteners?\b[^)]*?\)/gi, "")
    .replace(/\*+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanTitleName(name = "") {
  return String(name).replace(/\s{2,}/g, " ").trim();
}

function songKey(title, artist) {
  return `${cleanArtistName(artist)} - ${cleanTitleName(title)}`.toLowerCase().trim();
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.json();
}

/* -------------------------
   Cover fallback (global onerror)
------------------------- */
window.__coverFallback = function (imgEl) {
  try {
    const list = (imgEl.dataset.fallbacks || "").split("|").filter(Boolean);
    const idx = Number(imgEl.dataset.fallbackIndex || "0");
    const nextIdx = idx + 1;
    if (nextIdx >= list.length) return;
    imgEl.dataset.fallbackIndex = String(nextIdx);
    imgEl.src = list[nextIdx];
  } catch {
    // ignore
  }
};

function coverImgHtml(src) {
  const fallbacks = [src, ...COVER_FALLBACKS].filter(Boolean).join("|");
  const first = src || COVER_FALLBACKS[0];
  return `
    <img
      class="cover"
      src="${escapeHtml(first)}"
      data-fallbacks="${escapeHtml(fallbacks)}"
      data-fallback-index="0"
      onerror="window.__coverFallback(this)"
      loading="lazy"
      alt=""
    />
  `;
}

/* -------------------------
   Movement badge (uses your CSS: .move.up/.down/.new/.re)
------------------------- */
function moveLabel(m) {
  if (!m) return { text: "—", cls: "" };
  if (m.type === "up") return { text: `▲ ${m.value}`, cls: "up" };
  if (m.type === "down") return { text: `▼ ${m.value}`, cls: "down" };
  if (m.type === "new") return { text: "NEW", cls: "new" };
  if (m.type === "re") return { text: "RE", cls: "re" };
  return { text: "—", cls: "" };
}

/* -------------------------
   Catalog lookup + "as-of-week" stats
------------------------- */
function buildSongLookup(catalog) {
  const lookup = new Map();
  for (const [, artistObj] of Object.entries(catalog.artists || {})) {
    const songs = artistObj.songs || {};
    for (const [k, v] of Object.entries(songs)) {
      lookup.set(k.toLowerCase().trim(), v);
    }
  }
  return lookup;
}

function statsAsOfWeek(songObj, currentWeek) {
  const hist = Array.isArray(songObj?.history) ? songObj.history : [];
  const filtered = hist
    .filter(h => h && typeof h.week === "string" && h.week <= currentWeek && typeof h.rank === "number")
    .sort((a, b) => a.week.localeCompare(b.week));

  if (!filtered.length) return null;

  let peak = Infinity;
  for (const h of filtered) peak = Math.min(peak, h.rank);

  return {
    debut: filtered[0].week,
    peak: Number.isFinite(peak) ? peak : filtered[filtered.length - 1].rank,
    weeks: filtered.length,
    filteredHistory: filtered,
  };
}

function lastWeekRankAsOf(songObj, currentWeek) {
  const hist = Array.isArray(songObj?.history) ? songObj.history : [];
  const prev = hist
    .filter(h => h && typeof h.week === "string" && h.week < currentWeek && typeof h.rank === "number")
    .sort((a, b) => b.week.localeCompare(a.week))[0];
  return prev ? prev.rank : null;
}

/* -------------------------
   Awards (inline under artist)
------------------------- */
function computeAwards(entries, statsByKey) {
  let biggestJump = null;   // { key, val }
  let biggestFall = null;   // { key, val }
  let hotShotDebut = null;  // { key, rank }
  let hotShotRe = null;     // { key, rank }
  let longest = null;       // { key, weeks }

  for (const e of entries) {
    const key = e.__key;
    const m = e.movement || null;

    if (m?.type === "up" && typeof m.value === "number") {
      if (!biggestJump || m.value > biggestJump.val) biggestJump = { key, val: m.value };
    }
    if (m?.type === "down" && typeof m.value === "number") {
      if (!biggestFall || m.value > biggestFall.val) biggestFall = { key, val: m.value };
    }

    if (m?.type === "new") {
      if (!hotShotDebut || e.rank < hotShotDebut.rank) hotShotDebut = { key, rank: e.rank };
    }
    if (m?.type === "re") {
      if (!hotShotRe || e.rank < hotShotRe.rank) hotShotRe = { key, rank: e.rank };
    }

    const s = statsByKey.get(key);
    const w = s?.weeks ?? e.weeks ?? 1;
    if (!longest || w > longest.weeks) longest = { key, weeks: w };
  }

  return { biggestJump, biggestFall, hotShotDebut, hotShotRe, longest };
}

function awardHtmlForEntry(entry, awards) {
  const key = entry.__key;
  const lines = [];

  const teal = "#6bd4b9";
  const green = "#7CFFB2";
  const red = "#FF7C7C";
  const blue = "#7CC7FF";
  const purple = "#D7B7FF";

  if (awards.biggestJump?.key === key)
    lines.push(`<span style="color:${green};font-weight:700;">Biggest Jump (+${awards.biggestJump.val})</span>`);
  if (awards.biggestFall?.key === key)
    lines.push(`<span style="color:${red};font-weight:700;">Biggest Fall (-${awards.biggestFall.val})</span>`);
  if (awards.hotShotDebut?.key === key)
    lines.push(`<span style="color:${blue};font-weight:700;">Hot Shot Debut</span>`);
  if (awards.hotShotRe?.key === key)
    lines.push(`<span style="color:${purple};font-weight:700;">Hot Shot Re-Entry</span>`);
  if (awards.longest?.key === key)
    lines.push(`<span style="color:${teal};font-weight:700;">Longest Chart Sitter</span>`);

  if (!lines.length) return "";
  return `<div class="awards" style="margin-top:6px;font-size:12px;line-height:1.15;">${lines.join("<br>")}</div>`;
}

/* -------------------------
   Expand panel (styled by your CSS: .expandInner/.expandTitle/.expandSub/.pills/.expandLinks/.history/.historyRow)
------------------------- */
function weekUrl(week) {
  return `/?week=${encodeURIComponent(week)}`;
}
function artistUrl(artistName) {
  return `/artist.html?artist=${encodeURIComponent(artistName)}`;
}

function buildHistoryHtml(songObj) {
  const hist = Array.isArray(songObj?.history) ? songObj.history : [];
  const rows = hist
    .filter(h => h && typeof h.week === "string" && typeof h.rank === "number")
    .sort((a, b) => b.week.localeCompare(a.week))
    .map(h => `
      <div class="historyRow">
        <span><a href="${weekUrl(h.week)}" onclick="event.stopPropagation()">${escapeHtml(h.week)}</a></span>
        <span>Rank <b>#${escapeHtml(h.rank)}</b></span>
      </div>
    `)
    .join("");

  return `<div class="history">${rows || `<div class="mutedSmall">No history found.</div>`}</div>`;
}

function buildExpandHtml(entry, displayArtist, week, stats, lwForDisplay, songObj) {
  const t = escapeHtml(entry.title);
  const a = escapeHtml(displayArtist);
  const peak = stats?.peak ?? entry.peak ?? entry.rank;
  const weeks = stats?.weeks ?? entry.weeks ?? 1;

  return `
    <div class="expand">
      <div class="expandInner">
        <div class="expandTop">
          <div>
            <div class="expandTitle">${t}</div>
            <div class="expandSub">
              <a class="artistLink" href="${artistUrl(displayArtist)}" onclick="event.stopPropagation()">${a}</a>
            </div>
          </div>

          <div class="pills">
            <span>LW <b>${escapeHtml(lwForDisplay)}</b></span>
            <span>Peak <b>${escapeHtml(peak)}</b></span>
            <span>Weeks <b>${escapeHtml(weeks)}</b></span>
          </div>
        </div>

        <div class="expandLinks">
          <a href="${artistUrl(displayArtist)}" onclick="event.stopPropagation()">Open artist page</a>
          <a href="${weekUrl(week)}" onclick="event.stopPropagation()">Open this week</a>
        </div>

        ${buildHistoryHtml(songObj)}
      </div>
    </div>
  `;
}

/* -------------------------
   Artist search dropdown (index page)
------------------------- */
function setupArtistSearch(catalog) {
  const input = document.getElementById("artistSearch");
  const box = document.getElementById("searchResults");
  if (!input || !box) return;

  // Deduplicate by cleaned name so malformed artists don't split into duplicates
  const artists = Object.keys(catalog.artists || {});
  const seen = new Map(); // cleanedLower -> canonical
  for (const a of artists) {
    const cleaned = cleanArtistName(a).toLowerCase();
    if (!seen.has(cleaned)) seen.set(cleaned, a);
  }

  const list = Array.from(seen.entries()).map(([cleaned, canonical]) => {
    const obj = catalog.artists[canonical] || {};
    const songsCount = Object.keys(obj.songs || {}).length;
    const totalEntries = obj.totalEntries ?? obj.entries ?? obj.total ?? null;
    return {
      cleaned,
      canonical,
      display: cleanArtistName(canonical),
      songsCount,
      totalEntries,
    };
  });

  function hide() {
    box.style.display = "none";
    box.innerHTML = "";
  }

  function show(items) {
    box.innerHTML = items
      .slice(0, 10)
      .map((it) => `
        <div class="searchItem" data-artist="${escapeHtml(it.display)}">
          <div class="searchName">${escapeHtml(it.display)}</div>
          <div class="searchMeta">${escapeHtml(it.songsCount)} song(s) • ${escapeHtml(it.totalEntries ?? "—")} chart entry(s)</div>
        </div>
      `)
      .join("");
    box.style.display = items.length ? "block" : "none";
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return hide();
    const hits = list.filter(it => it.cleaned.includes(q) || it.display.toLowerCase().includes(q));
    show(hits);
  });

  input.addEventListener("focus", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    const hits = list.filter(it => it.cleaned.includes(q) || it.display.toLowerCase().includes(q));
    show(hits);
  });

  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) hide();
  });

  box.addEventListener("click", (e) => {
    const item = e.target.closest(".searchItem");
    if (!item) return;
    const artist = item.getAttribute("data-artist");
    if (!artist) return;
    location.href = artistUrl(artist);
  });
}

/* -------------------------
   Render chart (MATCHES styles.css CLASSES)
------------------------- */
function renderChart(entries, week, catalogSongLookup) {
  const chartEl = document.getElementById("chart");
  if (!chartEl) return;

  // Precompute stats per entry key
  const statsByKey = new Map();
  for (const e of entries) {
    const key = e.__key;
    const sObj = catalogSongLookup.get(key);
    statsByKey.set(key, statsAsOfWeek(sObj, week));
  }

  const awards = computeAwards(entries, statsByKey);

  chartEl.innerHTML = entries.map((e) => {
    const displayTitle = cleanTitleName(e.title);
    const displayArtist = cleanArtistName(e.artist);

    const key = e.__key;
    const songObj = catalogSongLookup.get(key);

    const stats = statsByKey.get(key);
    const peak = stats?.peak ?? e.peak ?? e.rank;
    const weeks = stats?.weeks ?? e.weeks ?? 1;

    // LW rule: NEW/RE show —
    let lw = "—";
    if (e.movement?.type !== "new" && e.movement?.type !== "re") {
      const computedLW = lastWeekRankAsOf(songObj, week);
      lw = computedLW != null ? String(computedLW) : (e.lastWeek != null ? String(e.lastWeek) : "—");
    }

    const mv = moveLabel(e.movement);
    const awardLine = awardHtmlForEntry(e, awards);

    return `
      <li class="row" data-key="${escapeHtml(key)}">
        <div class="rowTop">
          <div class="rankbox">
            <div class="ranknum">${escapeHtml(e.rank)}</div>
            <div class="move ${mv.cls}">${escapeHtml(mv.text)}</div>
          </div>

          <!-- IMPORTANT: this uses your CSS flex layout -->
          <div class="songRow">
            ${coverImgHtml(e.cover)}
            <div class="song">
              <div class="titleline">${escapeHtml(displayTitle)}</div>
              <div class="artist">${escapeHtml(displayArtist)}</div>
              ${awardLine}
            </div>
          </div>

          <div class="stats3">
            <span>LW <b>${escapeHtml(lw)}</b></span>
            <span>Peak <b>${escapeHtml(peak)}</b></span>
            <span>Weeks <b>${escapeHtml(weeks)}</b></span>
          </div>
        </div>

        ${buildExpandHtml(
          { ...e, title: displayTitle },
          displayArtist,
          week,
          stats,
          lw,
          songObj
        )}
      </li>
    `;
  }).join("");

  // click to expand/collapse
  chartEl.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", () => {
      row.classList.toggle("open");
    });
  });
}

/* -------------------------
   Boot
------------------------- */
async function main() {
  const weekLabelEl = document.getElementById("weekLabel");
  const weekSelectEl = document.getElementById("weekSelect");
  const titleEl = document.getElementById("chartTitle");
  const footEl = document.getElementById("footInfo");

  function setFoot(msg) {
    if (footEl) footEl.textContent = msg;
  }

  // Load manifest + latest
  let manifest = null;
  let latest = null;

  try { manifest = await loadJSON(DATA.manifest); } catch {}
  try { latest = await loadJSON(DATA.latest); } catch {}

  const weeks = Array.isArray(manifest?.weeks) ? manifest.weeks : [];
  const requested = qs("week");

  let weekToLoad = null;
  if (requested && weeks.includes(requested)) weekToLoad = requested;
  else if (latest?.week && (!weeks.length || weeks.includes(latest.week))) weekToLoad = latest.week;
  else if (weeks.length) weekToLoad = weeks[0];

  // Fill dropdown
  if (weekSelectEl) {
    weekSelectEl.innerHTML = weeks.map(w => `<option value="${w}">${w}</option>`).join("");
    if (weekToLoad) weekSelectEl.value = weekToLoad;
    weekSelectEl.addEventListener("change", () => setQueryParam("week", weekSelectEl.value));
  }

  if (!weekToLoad) {
    if (weekLabelEl) weekLabelEl.textContent = "—";
    setFoot("Could not load week list (manifest.json missing or empty).");
    return;
  }

  // Title + label
  if (weekLabelEl) weekLabelEl.textContent = weekToLoad;
  if (titleEl) titleEl.textContent = "Nabnation Top 100";

  // Load catalog
  let catalog = null;
  try {
    catalog = await loadJSON(DATA.catalog);
  } catch {
    catalog = { artists: {} };
    setFoot("Loaded chart, but catalog.json failed (artist search / stats may be limited).");
  }

  setupArtistSearch(catalog);
  const catalogSongLookup = buildSongLookup(catalog);

  // Load selected week
  let weekData = null;
  try {
    weekData = await loadJSON(DATA.weekFile(weekToLoad));
  } catch {
    setFoot(`Failed to load data/${weekToLoad}.json`);
    return;
  }

  const entries = Array.isArray(weekData.entries) ? weekData.entries : [];
  for (const e of entries) {
    e.title = cleanTitleName(e.title);
    e.artist = cleanArtistName(e.artist);
    e.__key = songKey(e.title, e.artist);
  }

  renderChart(entries, weekToLoad, catalogSongLookup);

  const gen = weekData.generatedAt ? ` • Generated ${weekData.generatedAt}` : "";
  setFoot(`${entries.length} songs loaded${gen}`);
}

main().catch((err) => {
  console.error(err);
  const footEl = document.getElementById("footInfo");
  if (footEl) footEl.textContent = `Script error: ${err?.message || err}`;
});
