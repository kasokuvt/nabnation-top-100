/* =========================
   Nabnation Top 100 — chart.js
   Works with your index.html IDs:
   - chartTitle, weekLabel, weekSelect
   - artistSearch, searchResults
   - chart, footInfo
========================= */

/** Cover fallback chain (handles your "_placeholder.png" problem) */
const COVER_FALLBACKS = [
  "./covers/_placeholder.png",
  "./covers/placeholder.png",
  "./assets/icon.webp",
];

/** Data paths */
const DATA = {
  manifest: "./data/manifest.json",
  latest: "./data/latest.json",
  catalog: "./data/catalog.json",
  weekFile: (week) => `./data/${week}.json`,
};

/* -------------------------
   Small utilities
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

/** Removes your “(xx pts) (yy listeners)*” junk from artist display + search */
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

/** Key must match your exporter convention */
function songKey(title, artist) {
  return `${cleanArtistName(artist)} - ${cleanTitleName(title)}`.toLowerCase().trim();
}

/** Fetch JSON w/ no-store so GitHub Pages updates immediately */
async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.json();
}

/* -------------------------
   Cover fallback (global for onerror)
------------------------- */
window.__coverFallback = function (imgEl) {
  try {
    const list = (imgEl.dataset.fallbacks || "").split("|").filter(Boolean);
    const idx = Number(imgEl.dataset.fallbackIndex || "0");

    // First failure: switch from original cover -> first fallback
    // Subsequent failures: walk the fallback list
    const nextIdx = idx + 1;
    if (nextIdx >= list.length) return;

    imgEl.dataset.fallbackIndex = String(nextIdx);
    imgEl.src = list[nextIdx];
  } catch {
    // do nothing
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
   Movement badge
   Uses your CSS classes: .move .up/.down/.new/.re
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
   Catalog lookup + “as of week” stats
------------------------- */
function buildSongLookup(catalog) {
  // catalog.artists[Artist Name].songs[SongKeyLower] = { history: [{week,rank}], peak, weeks, ... }
  const lookup = new Map();

  for (const [artistName, artistObj] of Object.entries(catalog.artists || {})) {
    const songs = artistObj.songs || {};
    for (const [k, v] of Object.entries(songs)) {
      lookup.set(k.toLowerCase().trim(), v);
    }
  }
  return lookup;
}

/** Stats (debut, peak, weeks) computed ONLY using weeks <= currentWeek */
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
   - biggest jump
   - biggest fall
   - hot shot debut
   - hot shot reentry
   - longest chart sitter
------------------------- */
function computeAwards(entries, statsByKey) {
  let biggestJump = null;     // { key, val }
  let biggestFall = null;     // { key, val }
  let hotShotDebut = null;    // { key, rank }
  let hotShotRe = null;       // { key, rank }
  let longest = null;         // { key, weeks }

  for (const e of entries) {
    const key = e.__key;
    const m = e.movement || null;

    // jump/fall
    if (m?.type === "up" && typeof m.value === "number") {
      if (!biggestJump || m.value > biggestJump.val) biggestJump = { key, val: m.value };
    }
    if (m?.type === "down" && typeof m.value === "number") {
      if (!biggestFall || m.value > biggestFall.val) biggestFall = { key, val: m.value };
    }

    // hot shot debut/re
    if (m?.type === "new") {
      if (!hotShotDebut || e.rank < hotShotDebut.rank) hotShotDebut = { key, rank: e.rank };
    }
    if (m?.type === "re") {
      if (!hotShotRe || e.rank < hotShotRe.rank) hotShotRe = { key, rank: e.rank };
    }

    // longest sitter (as-of-week weeks)
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

  if (awards.biggestJump?.key === key) {
    lines.push(`<span style="color:${green};font-weight:700;">Biggest Jump (+${awards.biggestJump.val})</span>`);
  }
  if (awards.biggestFall?.key === key) {
    lines.push(`<span style="color:${red};font-weight:700;">Biggest Fall (-${awards.biggestFall.val})</span>`);
  }
  if (awards.hotShotDebut?.key === key) {
    lines.push(`<span style="color:${blue};font-weight:700;">Hot Shot Debut</span>`);
  }
  if (awards.hotShotRe?.key === key) {
    lines.push(`<span style="color:${purple};font-weight:700;">Hot Shot Re-Entry</span>`);
  }
  if (awards.longest?.key === key) {
    lines.push(`<span style="color:${teal};font-weight:700;">Longest Chart Sitter</span>`);
  }

  if (!lines.length) return "";
  return `<div class="awards" style="margin-top:6px;font-size:12px;line-height:1.15;">${lines.join("<br>")}</div>`;
}

/* -------------------------
   Expand panel (song history)
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
        <span><a href="${weekUrl(h.week)}">${escapeHtml(h.week)}</a></span>
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
      <div class="expandTop">
        <div class="expandTitle">${t}</div>
        <div class="expandArtist">
          <a class="artistLink" href="${artistUrl(displayArtist)}" onclick="event.stopPropagation()">${a}</a>
        </div>

        <div class="expandStats">
          LW <b>${lwForDisplay}</b> &nbsp; Peak <b>${peak}</b> &nbsp; Weeks <b>${weeks}</b>
        </div>

        <div class="expandLinks">
          <a href="${artistUrl(displayArtist)}" onclick="event.stopPropagation()">Open artist page</a>
          <a href="${weekUrl(week)}" onclick="event.stopPropagation()">Open this week</a>
        </div>
      </div>

      <div class="divider"></div>
      ${buildHistoryHtml(songObj)}
    </div>
  `;
}

/* -------------------------
   Chart rendering
------------------------- */
function renderChart(entries, week, catalogSongLookup) {
  const chartEl = document.getElementById("chart");
  if (!chartEl) return;

  // Precompute stats per entry key
  const statsByKey = new Map();
  for (const e of entries) {
    const key = e.__key;
    const sObj = catalogSongLookup.get(key);
    const s = statsAsOfWeek(sObj, week);
    statsByKey.set(key, s);
  }

  // Awards need the weeks-as-of-week (statsByKey)
  const awards = computeAwards(entries, statsByKey);

  chartEl.innerHTML = entries
    .map((e) => {
      const displayTitle = cleanTitleName(e.title);
      const displayArtist = cleanArtistName(e.artist);

      const key = e.__key;
      const songObj = catalogSongLookup.get(key);

      const stats = statsByKey.get(key);
      const peak = stats?.peak ?? e.peak ?? e.rank;
      const weeks = stats?.weeks ?? e.weeks ?? 1;

      // LW rules:
      // - NEW/RE should show "—"
      // - otherwise show last week rank as-of-week if possible, else e.lastWeek, else "—"
      let lw = "—";
      if (e.movement?.type !== "new" && e.movement?.type !== "re") {
        const computedLW = lastWeekRankAsOf(songObj, week);
        lw = computedLW != null ? String(computedLW) : (e.lastWeek != null ? String(e.lastWeek) : "—");
      }

      const mv = moveLabel(e.movement);
      const awardLine = awardHtmlForEntry(e, awards);

      // build row
      return `
        <li class="row" data-key="${escapeHtml(key)}">
          <div class="rowTop">
            <div class="rankbox">
              <div class="ranknum">${escapeHtml(e.rank)}</div>
              <div class="move ${mv.cls}">${escapeHtml(mv.text)}</div>
            </div>

            <div class="songbox">
              ${coverImgHtml(e.cover)}
              <div class="songmeta">
                <div class="songtitle">${escapeHtml(displayTitle)}</div>
                <div class="songartist">${escapeHtml(displayArtist)}</div>
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
    })
    .join("");

  // click to expand/collapse
  chartEl.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", () => {
      row.classList.toggle("open");
    });
  });
}

/* -------------------------
   Artist search dropdown (index page)
------------------------- */
function setupArtistSearch(catalog) {
  const input = document.getElementById("artistSearch");
  const box = document.getElementById("searchResults");
  if (!input || !box) return;

  // Deduplicate by cleaned name so you don’t get “fakemink (60 pts…)” as separate entries
  const artists = Object.keys(catalog.artists || {});
  const seen = new Map(); // cleaned -> canonical
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

  // 1) Load manifest + latest (whichever works)
  let manifest = null;
  let latest = null;

  try { manifest = await loadJSON(DATA.manifest); } catch (e) { /* ignore */ }
  try { latest = await loadJSON(DATA.latest); } catch (e) { /* ignore */ }

  const weeks = (manifest?.weeks && Array.isArray(manifest.weeks)) ? manifest.weeks : [];
  const requested = qs("week");

  // Pick a week:
  // - if ?week= is valid, use it
  // - else if latest.week exists, use it
  // - else use first manifest week
  let weekToLoad = null;

  if (requested && weeks.includes(requested)) weekToLoad = requested;
  else if (latest?.week && (!weeks.length || weeks.includes(latest.week))) weekToLoad = latest.week;
  else if (weeks.length) weekToLoad = weeks[0];

  // Populate dropdown
  if (weekSelectEl) {
    weekSelectEl.innerHTML = weeks.map(w => `<option value="${w}">${w}</option>`).join("");
    if (weekToLoad) weekSelectEl.value = weekToLoad;
    weekSelectEl.addEventListener("change", () => setQueryParam("week", weekSelectEl.value));
  }

  if (!weekToLoad) {
    // Nothing to load (manifest missing or empty)
    if (weekLabelEl) weekLabelEl.textContent = "—";
    setFoot("Could not load week list (manifest.json missing or empty).");
    return;
  }

  // Label/title
  if (weekLabelEl) weekLabelEl.textContent = weekToLoad;
  if (titleEl) titleEl.textContent = "Nabnation Top 100";

  // 2) Load catalog (needed for search + as-of-week stats)
  let catalog = null;
  try {
    catalog = await loadJSON(DATA.catalog);
  } catch (e) {
    // still allow chart render without catalog stats
    catalog = { artists: {} };
    setFoot("Loaded chart, but catalog.json failed (artist search / stats may be limited).");
  }

  setupArtistSearch(catalog);

  // Build song lookup from catalog
  const catalogSongLookup = buildSongLookup(catalog);

  // 3) Load week chart data and render
  let weekData = null;
  try {
    weekData = await loadJSON(DATA.weekFile(weekToLoad));
  } catch (e) {
    if (weekLabelEl) weekLabelEl.textContent = weekToLoad;
    setFoot(`Failed to load data/${weekToLoad}.json`);
    return;
  }

  const entries = Array.isArray(weekData.entries) ? weekData.entries : [];
  // Attach computed key per entry
  for (const e of entries) {
    e.title = cleanTitleName(e.title);
    e.artist = cleanArtistName(e.artist);
    e.__key = songKey(e.title, e.artist);
  }

  renderChart(entries, weekToLoad, catalogSongLookup);

  // Footer info
  const gen = weekData.generatedAt ? ` • Generated ${weekData.generatedAt}` : "";
  setFoot(`${entries.length} songs loaded${gen}`);
}

main().catch((err) => {
  console.error(err);
  const footEl = document.getElementById("footInfo");
  if (footEl) footEl.textContent = `Script error: ${err?.message || err}`;
});
