/* =========================================
   Nabnation Top 100 — chart.js
   - Correct per-week stats (LW/Peak/Weeks)
   - Re-entry LW fix (LW —)
   - Awards per week (inline under artist)
   - Clean artist search (removes pts/listeners junk)
   - Robust cover fallbacks (GitHub Pages underscore issue)
========================================= */

const DATA_DIR = "./data";

// GitHub Pages + Jekyll sometimes breaks files starting with "_"
const PLACEHOLDER_PRIMARY = "covers/_placeholder.png";
const PLACEHOLDER_FALLBACK = "covers/placeholder.png";

// ---------- small helpers ----------
function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function setWeekParam(week) {
  const u = new URL(location.href);
  u.searchParams.set("week", week);
  location.href = u.toString();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

// Remove junk that accidentally got glued onto artist names
// Examples:
// "fakemink (60.0 pts) (6 listeners)* (new release)"
function cleanArtistName(raw) {
  let s = safeText(raw);
  s = s.replace(/\s*\*+\s*$/g, ""); // trailing *'s
  // Remove parentheses segments that look like pts/listeners/new release
  s = s.replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => {
    const t = inner.toLowerCase();
    if (
      t.includes("pt") ||
      t.includes("pts") ||
      t.includes("listener") ||
      t.includes("listeners") ||
      t.includes("new release")
    ) return " ";
    return ` (${inner}) `;
  });
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function cleanTitle(raw) {
  let s = safeText(raw);
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function songKey(title, artist) {
  const t = cleanTitle(title).toLowerCase();
  const a = cleanArtistName(artist).toLowerCase();
  // stable key
  return `${a} — ${t}`.trim();
}

function artistUrl(artistName) {
  const a = cleanArtistName(artistName);
  return `artist.html?artist=${encodeURIComponent(a)}`;
}

function weekUrl(weekStr) {
  return `?week=${encodeURIComponent(weekStr)}`;
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return await res.json();
}

function fmtRankOrDash(v) {
  return (v === null || v === undefined) ? "—" : String(v);
}

// Attach robust fallback to ALL images inside root
function attachImgFallback(root) {
  const imgs = root.querySelectorAll("img");
  imgs.forEach((img) => {
    img.addEventListener("error", () => {
      // Prevent infinite loops
      const tried = img.getAttribute("data-fallback-tried");
      if (tried === "2") return;

      const cur = img.getAttribute("src") || "";
      // If it’s already the fallback, stop after second try
      if (cur.includes("_placeholder")) {
        img.setAttribute("data-fallback-tried", "2");
        img.src = PLACEHOLDER_FALLBACK;
        return;
      }

      if (cur.includes("placeholder.png") || cur.includes("covers/placeholder.png")) {
        img.setAttribute("data-fallback-tried", "2");
        img.src = PLACEHOLDER_PRIMARY;
        return;
      }

      // First fallback attempt: try placeholder (no underscore)
      img.setAttribute("data-fallback-tried", "1");
      img.src = PLACEHOLDER_FALLBACK;
    });
  });
}

// ---------- movement / badges ----------
function movementBadge(mv) {
  // mv: {type, value}
  if (!mv || !mv.type) return { text: "—", cls: "" };

  const type = mv.type;
  const val = mv.value;

  if (type === "new") return { text: "NEW", cls: "new" };
  if (type === "re") return { text: "RE", cls: "re" };
  if (type === "up") return { text: `▲ ${Math.abs(val ?? 0)}`, cls: "up" };
  if (type === "down") return { text: `▼ ${Math.abs(val ?? 0)}`, cls: "down" };
  if (type === "same") return { text: "—", cls: "same" };

  return { text: "—", cls: "" };
}

// ---------- Awards ----------
function computeAwardsForWeek(entries) {
  // Returns Map(songKey -> array of award strings)
  const awards = new Map();

  function add(key, obj) {
    if (!awards.has(key)) awards.set(key, []);
    awards.get(key).push(obj);
  }

  // Biggest jump / fall consider only normal up/down moves (not new/re)
  let bestJump = null; // {key, delta}
  let bestFall = null; // {key, delta}
  let hotShotDebut = null; // {key, rank}
  let hotShotReentry = null; // {key, rank}
  let longestSitter = null; // {key, weeks}

  for (const e of entries) {
    const key = e._key;
    const rank = e.rank;

    // longest sitter
    if (typeof e.weeks === "number") {
      if (!longestSitter || e.weeks > longestSitter.weeks || (e.weeks === longestSitter.weeks && rank < longestSitter.rank)) {
        longestSitter = { key, weeks: e.weeks, rank };
      }
    }

    // debut / reentry
    if (e.movement?.type === "new") {
      if (!hotShotDebut || rank < hotShotDebut.rank) hotShotDebut = { key, rank };
    }
    if (e.movement?.type === "re") {
      if (!hotShotReentry || rank < hotShotReentry.rank) hotShotReentry = { key, rank };
    }

    // jump / fall
    if (e.movement?.type === "up" && typeof e.movement.value === "number") {
      const d = Math.abs(e.movement.value);
      if (!bestJump || d > bestJump.delta || (d === bestJump.delta && rank < bestJump.rank)) {
        bestJump = { key, delta: d, rank };
      }
    }
    if (e.movement?.type === "down" && typeof e.movement.value === "number") {
      const d = Math.abs(e.movement.value);
      if (!bestFall || d > bestFall.delta || (d === bestFall.delta && rank < bestFall.rank)) {
        bestFall = { key, delta: d, rank };
      }
    }
  }

  if (bestJump) add(bestJump.key, { text: `Biggest Jump (+${bestJump.delta})`, color: "#7cffb2" });
  if (bestFall) add(bestFall.key, { text: `Biggest Fall (-${bestFall.delta})`, color: "#ff7c7c" });
  if (hotShotDebut) add(hotShotDebut.key, { text: "Hot Shot Debut", color: "#7cc7ff" });
  if (hotShotReentry) add(hotShotReentry.key, { text: "Hot Shot Re-Entry", color: "#b38cff" });
  if (longestSitter) add(longestSitter.key, { text: "Longest Chart Sitter", color: "#ffd37c" });

  return awards;
}

// ---------- Build per-week derived stats from loaded weeks ----------
function buildDerived(weeksAsc, weekDataByWeek, targetWeek) {
  // Build:
  // - historyMap: key -> [{week, rank}] (DESC for display)
  // - statsAtWeek: key -> {weeks, peak, debutDate, peakDate}
  // - prevWeekRanks: key -> rank (only for immediate previous week)
  const seenStats = new Map();
  const historyMap = new Map();

  let prevWeekRanks = new Map();

  for (const w of weeksAsc) {
    const data = weekDataByWeek.get(w);
    const entries = Array.isArray(data?.entries) ? data.entries : [];

    const thisWeekRanks = new Map();

    for (const raw of entries) {
      const title = cleanTitle(raw.title);
      const artist = cleanArtistName(raw.artist);
      if (!title || !artist) continue;

      const key = songKey(title, artist);
      const rank = Number(raw.rank);

      if (!Number.isFinite(rank)) continue;

      thisWeekRanks.set(key, rank);

      // history
      if (!historyMap.has(key)) historyMap.set(key, []);
      historyMap.get(key).push({ week: w, rank });

      // stats
      if (!seenStats.has(key)) {
        seenStats.set(key, {
          weeks: 0,
          peak: rank,
          debutDate: w,
          peakDate: w
        });
      }
      const st = seenStats.get(key);
      st.weeks += 1;

      if (rank < st.peak) {
        st.peak = rank;
        st.peakDate = w;
      }
    }

    if (w === targetWeek) {
      // Stop once we finish target week stats
      prevWeekRanks = prevWeekRanks; // keep from previous iteration
      break;
    }

    prevWeekRanks = thisWeekRanks;
  }

  // Convert history to DESC order (latest first)
  for (const [k, arr] of historyMap.entries()) {
    arr.sort((a, b) => b.week.localeCompare(a.week));
  }

  return { seenStats, historyMap, prevWeekRanks };
}

function deriveEntryForWeek(rawEntry, targetWeek, prevWeekRanks, seenStats, historyMap, isInPrevWeek, wasEverBefore) {
  const title = cleanTitle(rawEntry.title);
  const artist = cleanArtistName(rawEntry.artist);
  const rank = Number(rawEntry.rank);

  const key = songKey(title, artist);

  const st = seenStats.get(key) || { weeks: null, peak: null, debutDate: null, peakDate: null };
  const history = historyMap.get(key) || [];

  const lastWeekRank = prevWeekRanks.get(key) ?? null;

  // Determine movement type in a Billboard-ish way:
  // - NEW: never charted before this week
  // - RE: charted before, but NOT last week
  // - up/down/same: based on last week
  let movement = { type: "same", value: 0 };

  if (!wasEverBefore) {
    movement = { type: "new", value: null };
  } else if (!isInPrevWeek) {
    // re-entry
    movement = { type: "re", value: null };
  } else {
    const delta = lastWeekRank - rank;
    if (delta > 0) movement = { type: "up", value: delta };
    else if (delta < 0) movement = { type: "down", value: Math.abs(delta) };
    else movement = { type: "same", value: 0 };
  }

  // LW display rule:
  // - if re-entry or new: LW should be null (shows —)
  // - else use lastWeekRank
  const lw = (movement.type === "new" || movement.type === "re") ? null : lastWeekRank;

  // Cover: prefer explicit cover, but repair blanks/placeholder-ish values
  let cover = safeText(rawEntry.cover, "");
  if (!cover || cover.includes("placeholder")) {
    // force to placeholder; fallback handler will fix if underscore is blocked
    cover = PLACEHOLDER_PRIMARY;
  }

  return {
    rank,
    title,
    artist,
    cover,
    movement,
    lastWeek: lw,
    peak: st.peak,
    weeks: st.weeks,
    debutDate: st.debutDate,
    peakDate: st.peakDate,
    history,
    _key: key
  };
}

function buildHistoryHtml(history) {
  if (!history.length) return `<div class="muted">No history available.</div>`;

  return `
    <div class="history">
      ${history.map(h => {
        const wk = escapeHtml(h.week);
        const rk = escapeHtml(`#${h.rank}`);
        return `
          <div class="historyRow">
            <div>${wk}</div>
            <div><b>Rank</b> ${rk}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildExpandHtml(entry) {
  const title = escapeHtml(entry.title);
  const artist = escapeHtml(entry.artist);

  const lw = escapeHtml(fmtRankOrDash(entry.lastWeek));
  const peak = escapeHtml(fmtRankOrDash(entry.peak));
  const weeks = escapeHtml(fmtRankOrDash(entry.weeks));

  const debut = escapeHtml(entry.debutDate ?? "—");
  const peakDate = escapeHtml(entry.peakDate ?? "—");

  return `
    <div class="expandInner">
      <div class="expandTop">
        <div class="expandTitle">${title}</div>
        <div class="expandArtist">
          <a href="${artistUrl(entry.artist)}">${artist}</a>
        </div>

        <div class="expandStats">
          <span>LW <b>${lw}</b></span>
          <span>Peak <b>${peak}</b></span>
          <span>Weeks <b>${weeks}</b></span>
        </div>

        <div class="expandLinks">
          <a href="${artistUrl(entry.artist)}">Open artist page</a>
          <a href="${weekUrl(qs("week") || "")}">Open this week</a>
        </div>

        <div class="expandMeta">
          <span>Debut <b>${debut}</b></span>
          <span>Peak Date <b>${peakDate}</b></span>
        </div>
      </div>

      <div class="divider"></div>

      ${buildHistoryHtml(entry.history)}
    </div>
  `;
}

// ---------- Artist search ----------
function setupArtistSearch(allWeekEntries) {
  const input = document.getElementById("artistSearch");
  const results = document.getElementById("searchResults");
  if (!input || !results) return;

  // Build artist index:
  // name -> { songs:Set, entries:number, bestPeak:number }
  const idx = new Map();

  for (const e of allWeekEntries) {
    const a = cleanArtistName(e.artist);
    const t = cleanTitle(e.title);
    if (!a || !t) continue;

    if (!idx.has(a)) idx.set(a, { songs: new Set(), entries: 0, bestPeak: Infinity });
    const obj = idx.get(a);
    obj.songs.add(`${a} — ${t}`.toLowerCase());
    obj.entries += 1;
    if (Number.isFinite(e.rank)) obj.bestPeak = Math.min(obj.bestPeak, e.rank);
  }

  const allArtists = [...idx.entries()].map(([name, o]) => ({
    name,
    songCount: o.songs.size,
    entryCount: o.entries,
    bestPeak: (o.bestPeak === Infinity ? null : o.bestPeak)
  }));

  function hide() {
    results.classList.add("hidden");
    results.innerHTML = "";
  }

  function show(items) {
    results.innerHTML = items.map(it => {
      const peakTxt = it.bestPeak ? ` • Best peak: #${it.bestPeak}` : "";
      return `
        <div class="searchItem" tabindex="0" data-artist="${escapeHtml(it.name)}">
          <div class="name">${escapeHtml(it.name)}</div>
          <div class="meta">${it.songCount} song(s) • ${it.entryCount} chart entry(s)${escapeHtml(peakTxt)}</div>
        </div>
      `;
    }).join("");
    results.classList.remove("hidden");

    // click
    results.querySelectorAll(".searchItem").forEach((node) => {
      node.addEventListener("click", () => {
        const a = node.getAttribute("data-artist") || "";
        location.href = artistUrl(a);
      });
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter") node.click();
      });
    });
  }

  function filter(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];

    // prioritize "starts with"
    const starts = [];
    const contains = [];

    for (const it of allArtists) {
      const name = it.name.toLowerCase();
      if (name.startsWith(s)) starts.push(it);
      else if (name.includes(s)) contains.push(it);
    }

    // sort a bit so results look consistent
    starts.sort((a,b) => (a.bestPeak ?? 9999) - (b.bestPeak ?? 9999));
    contains.sort((a,b) => (a.bestPeak ?? 9999) - (b.bestPeak ?? 9999));

    return [...starts, ...contains].slice(0, 12);
  }

  input.addEventListener("input", () => {
    const items = filter(input.value);
    if (!items.length) hide();
    else show(items);
  });

  input.addEventListener("focus", () => {
    const items = filter(input.value);
    if (items.length) show(items);
  });

  // close dropdown if clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== input) hide();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

// ---------- main render ----------
function toggleRow(row) {
  const expand = row.querySelector(".expand");
  if (!expand) return;

  const isOpen = row.classList.contains("open");

  // close
  if (isOpen) {
    row.classList.remove("open");
    expand.innerHTML = "";
    return;
  }

  // open
  row.classList.add("open");

  // build on demand
  const entryJson = row.getAttribute("data-entry");
  if (!entryJson) return;

  let entry;
  try {
    entry = JSON.parse(entryJson);
  } catch {
    expand.innerHTML = `<div class="expandInner">Failed to expand.</div>`;
    return;
  }

  expand.innerHTML = buildExpandHtml(entry);
  attachImgFallback(expand);
}

async function main() {
  const list = document.getElementById("chart");
  const weekLabel = document.getElementById("weekLabel");
  const weekSelect = document.getElementById("weekSelect");
  const footInfo = document.getElementById("footInfo");

  if (!list || !weekSelect || !weekLabel) {
    console.error("Missing #chart or #weekSelect or #weekLabel");
    return;
  }

  // Load manifest (weeks list)
  let weeksDesc = [];
  try {
    const manifest = await loadJSON(`${DATA_DIR}/manifest.json`);
    weeksDesc = Array.isArray(manifest?.weeks) ? manifest.weeks.slice() : [];
  } catch (e) {
    console.warn("manifest.json missing, falling back to latest.json", e);
    try {
      const latest = await loadJSON(`${DATA_DIR}/latest.json`);
      if (latest?.week) weeksDesc = [latest.week];
    } catch (e2) {
      list.innerHTML = `<li class="row"><div class="rowTop">Failed to load chart data. Check console.</div></li>`;
      throw e2;
    }
  }

  if (!weeksDesc.length) {
    list.innerHTML = `<li class="row"><div class="rowTop">No weeks found in data/manifest.json</div></li>`;
    return;
  }

  const requested = qs("week");
  const targetWeek = (requested && weeksDesc.includes(requested)) ? requested : weeksDesc[0];

  // Populate dropdown
  weekSelect.innerHTML = weeksDesc.map(w => `<option value="${w}">${w}</option>`).join("");
  weekSelect.value = targetWeek;
  weekSelect.addEventListener("change", () => setWeekParam(weekSelect.value));

  weekLabel.textContent = `Week of ${targetWeek}`;

  // For per-week correctness we need all weeks up to targetWeek (chronological)
  const weeksAsc = weeksDesc.slice().reverse();
  const targetIdxAsc = weeksAsc.indexOf(targetWeek);
  const neededWeeksAsc = weeksAsc.slice(0, targetIdxAsc + 1);

  // Load needed week JSON files (cache)
  const weekDataByWeek = new Map();
  await Promise.all(neededWeeksAsc.map(async (w) => {
    try {
      const data = await loadJSON(`${DATA_DIR}/${w}.json`);
      weekDataByWeek.set(w, data);
    } catch (e) {
      console.warn("Missing week file:", w, e);
      // If the selected week file is missing, try latest.json as last resort
      if (w === targetWeek) {
        const latest = await loadJSON(`${DATA_DIR}/latest.json`);
        weekDataByWeek.set(w, latest);
      } else {
        weekDataByWeek.set(w, { week: w, entries: [] });
      }
    }
  }));

  // Build derived stats/history up to targetWeek
  const { seenStats, historyMap, prevWeekRanks } = buildDerived(neededWeeksAsc, weekDataByWeek, targetWeek);

  // Determine “wasEverBefore” & “isInPrevWeek” for movement calculation
  // We need:
  // - songs in prev week (immediate previous week only)
  const prevWeek = (targetIdxAsc > 0) ? weeksAsc[targetIdxAsc - 1] : null;
  const prevWeekEntries = prevWeek ? (weekDataByWeek.get(prevWeek)?.entries || []) : [];
  const prevWeekSet = new Set(prevWeekEntries.map(e => songKey(e.title, e.artist)));

  // Also need “ever before this week”
  // We can build it by looking at historyMap and seeing if there is any entry strictly older than targetWeek
  function wasEverBefore(key) {
    const hist = historyMap.get(key) || [];
    // hist includes targetWeek itself; if there’s any week older, it was before
    return hist.some(h => h.week < targetWeek);
  }

  // Build the week entries (from the file, but we derive stats/movement ourselves)
  const weekData = weekDataByWeek.get(targetWeek);
  const rawEntries = Array.isArray(weekData?.entries) ? weekData.entries : [];

  // Derive and normalize entries
  const derivedEntries = [];
  for (const raw of rawEntries) {
    const title = cleanTitle(raw.title);
    const artist = cleanArtistName(raw.artist);
    const key = songKey(title, artist);

    const isInPrev = prevWeekSet.has(key);
    const everBefore = wasEverBefore(key);

    const entry = deriveEntryForWeek(raw, targetWeek, prevWeekRanks, seenStats, historyMap, isInPrev, everBefore);
    derivedEntries.push(entry);
  }

  // Awards for this week
  const awardsMap = computeAwardsForWeek(derivedEntries);

  // Render
  list.innerHTML = derivedEntries.map((e) => {
    const mv = movementBadge(e.movement);

    const cover = escapeHtml(e.cover || PLACEHOLDER_PRIMARY);
    const ariaId = `exp-${e.rank}`;

    const awards = awardsMap.get(e._key) || [];
    const awardsHtml = awards.length
      ? `<div class="awardLine">${awards.map(a => `<div style="margin-top:6px;font-weight:800;color:${a.color}">${escapeHtml(a.text)}</div>`).join("")}</div>`
      : "";

    // Store full entry JSON on the row for expand/collapse
    const entryPayload = escapeHtml(JSON.stringify(e));

    return `
      <li class="row" data-entry="${entryPayload}">
        <div class="rowTop" tabindex="0" aria-controls="${ariaId}" aria-expanded="false">
          <div class="rankbox">
            <div class="rank">${escapeHtml(e.rank)}</div>
            <div class="move ${mv.cls}">${escapeHtml(mv.text)}</div>
          </div>

          <div class="songRow">
            <img class="cover" src="${cover}" alt="" loading="lazy" />
            <div class="song">
              <div class="titleline">${escapeHtml(e.title)}</div>
              <div class="artist">
                <a href="${artistUrl(e.artist)}" onclick="event.stopPropagation()">${escapeHtml(e.artist)}</a>
              </div>
              ${awardsHtml}
            </div>
          </div>

          <div class="stats3">
            <span>LW <b>${escapeHtml(fmtRankOrDash(e.lastWeek))}</b></span>
            <span>Peak <b>${escapeHtml(fmtRankOrDash(e.peak))}</b></span>
            <span>Weeks <b>${escapeHtml(fmtRankOrDash(e.weeks))}</b></span>
          </div>
        </div>

        <div class="expand" id="${ariaId}"></div>
      </li>
    `;
  }).join("");

  attachImgFallback(list);

  // Click-to-expand / collapse
  list.querySelectorAll(".row").forEach((row) => {
    const top = row.querySelector(".rowTop");
    if (!top) return;

    top.addEventListener("click", () => toggleRow(row));
    top.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleRow(row);
      }
    });
  });

  // Build artist search index from all loaded entries up to latest available in manifest
  // (To keep it responsive, we only use the weeks we already loaded up to selected week.)
  const allEntriesForSearch = [];
  for (const w of neededWeeksAsc) {
    const data = weekDataByWeek.get(w);
    const arr = Array.isArray(data?.entries) ? data.entries : [];
    for (const it of arr) allEntriesForSearch.push({
      artist: it.artist,
      title: it.title,
      rank: it.rank
    });
  }
  setupArtistSearch(allEntriesForSearch);

  if (footInfo) {
    footInfo.textContent = `Loaded ${derivedEntries.length} entries • ${targetWeek}`;
  }
}

main().catch((err) => {
  console.error(err);
  const list = document.getElementById("chart");
  if (list) {
    list.innerHTML = `
      <li class="row">
        <div class="rowTop">
          Failed to load chart data. Check console.
        </div>
      </li>
    `;
  }
});
