const PLACEHOLDER = "covers/_placeholder.png";

/* ===========================
   Helpers
   =========================== */

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return await res.json();
}

function fmtRankOrDash(v) {
  return (v === null || v === undefined) ? "—" : String(v);
}

function artistUrl(artistName) {
  return `artist.html?name=${encodeURIComponent(artistName)}`;
}

function weekUrl(weekStr) {
  return `/?week=${encodeURIComponent(weekStr)}`;
}

function songKey(title, artist) {
  return `${artist} - ${title}`.toLowerCase().trim();
}

function setWeekParam(week) {
  const u = new URL(location.href);
  u.searchParams.set("week", week);
  location.href = u.toString();
}

function attachImgFallback(root) {
  root.querySelectorAll("img.cover").forEach(img => {
    img.addEventListener("error", () => {
      if (img.src.includes(PLACEHOLDER)) return;
      img.src = PLACEHOLDER;
    });
  });
}

function moveLabel(m) {
  if (!m) return { text: "—", cls: "" };
  if (m.type === "up") return { text: `▲ ${m.value}`, cls: "up" };
  if (m.type === "down") return { text: `▼ ${m.value}`, cls: "down" };
  if (m.type === "new") return { text: "NEW", cls: "new" };
  if (m.type === "re") return { text: "RE", cls: "re" };
  if (m.type === "stay") return { text: "•", cls: "" };
  return { text: "—", cls: "" };
}

function getPrevWeek(weeksNewestFirst, currentWeek) {
  const idx = weeksNewestFirst.indexOf(currentWeek);
  if (idx === -1) return null;
  return weeksNewestFirst[idx + 1] || null; // newest->oldest
}

/* ===========================
   Canonical matching fallback
   (fix "some weeks look fine, other weeks don't")
   =========================== */

function canon(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")      // remove accents
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")          // remove punctuation
    .trim()
    .replace(/\s+/g, " ");
}

function canonKey(title, artist) {
  return `${canon(artist)} - ${canon(title)}`;
}

/* ===========================
   De-dupe history by week
   Keeps best rank for that week
   =========================== */

function dedupHistory(history) {
  // returns array of {week, rank} with unique weeks (best rank kept)
  if (!Array.isArray(history)) return [];
  const bestByWeek = new Map();
  for (const h of history) {
    const w = String(h.week);
    const r = Number(h.rank);
    if (!bestByWeek.has(w)) bestByWeek.set(w, r);
    else bestByWeek.set(w, Math.min(bestByWeek.get(w), r));
  }
  return Array.from(bestByWeek.entries()).map(([week, rank]) => ({ week, rank }));
}

/* ===========================
   AS-OF STATS (fixed + deduped)
   =========================== */

function statsAsOf(songObj, weekStr) {
  if (!songObj || !Array.isArray(songObj.history)) {
    return { peak: null, weeks: null };
  }

  const hist = dedupHistory(songObj.history);
  const upTo = hist.filter(h => String(h.week) <= String(weekStr));
  if (!upTo.length) return { peak: null, weeks: 0 };

  const peak = Math.min(...upTo.map(h => Number(h.rank)));
  return { peak, weeks: upTo.length };
}

function lastWeekRankImmediate(songObj, prevWeekStr) {
  if (!prevWeekStr) return null;
  if (!songObj || !Array.isArray(songObj.history)) return null;

  const hist = dedupHistory(songObj.history);
  const hit = hist.find(h => String(h.week) === String(prevWeekStr));
  return hit ? Number(hit.rank) : null;
}

/* ===========================
   Expand panel (history filtered + deduped)
   =========================== */

function buildHistoryHtml(history, asOfWeek) {
  const hist = dedupHistory(history || []);
  const filtered = hist.filter(h => String(h.week) <= String(asOfWeek));

  if (!filtered.length) {
    return `<div class="history"><div class="historyRow"><span>No history yet.</span></div></div>`;
  }

  const rows = [...filtered].sort((a, b) =>
    String(b.week).localeCompare(String(a.week)) || (a.rank - b.rank)
  );

  return `
    <div class="history">
      ${rows.map(h => `
        <div class="historyRow">
          <span><a href="${weekUrl(h.week)}">${escapeHtml(h.week)}</a></span>
          <span>Rank <b>#${escapeHtml(h.rank)}</b></span>
        </div>
      `).join("")}
    </div>
  `;
}

function buildExpandHtml(entry, catalogSong, asOfWeek, prevWeekStr) {
  let lw = entry.lastWeek;
  let peak = entry.peak;
  let weeks = entry.weeks;

  const mtype = entry.movement?.type || null;
  const forceDashLW = (mtype === "new" || mtype === "re");

  const history = catalogSong?.history ?? [];

  if (catalogSong && asOfWeek) {
    const asof = statsAsOf(catalogSong, asOfWeek);
    if (asof.peak !== null) peak = asof.peak;
    if (asof.weeks !== null) weeks = asof.weeks;

    const lwRank = forceDashLW ? null : lastWeekRankImmediate(catalogSong, prevWeekStr);
    lw = (lwRank === null || Number.isNaN(lwRank)) ? null : lwRank;
  } else {
    if (forceDashLW) lw = null;
  }

  return `
    <div class="expandInner">
      <div class="expandTop">
        <div>
          <div class="expandTitle">${escapeHtml(entry.title)}</div>
          <div class="expandSub">
            <a href="${artistUrl(entry.artist)}" style="color:inherit; text-decoration:none; border-bottom:1px solid rgba(244,246,251,.25)">
              ${escapeHtml(entry.artist)}
            </a>
          </div>

          <div class="pills" style="margin-top:10px">
            <span>LW <b>${fmtRankOrDash(lw)}</b></span>
            <span>Peak <b>${fmtRankOrDash(peak)}</b></span>
            <span>Weeks <b>${fmtRankOrDash(weeks)}</b></span>
          </div>

          <div class="expandLinks">
            <a href="${artistUrl(entry.artist)}">Open artist page</a>
            <a href="${weekUrl(entry._week)}">Open this week</a>
          </div>
        </div>
      </div>

      ${buildHistoryHtml(history, asOfWeek)}
    </div>
  `;
}

/* ===========================
   Artist Search
   =========================== */

function setupArtistSearch(catalog) {
  const input = document.getElementById("artistSearch");
  const box = document.getElementById("searchResults");
  if (!input || !box) return;

  const artists = Object.keys(catalog?.artists || {});
  const artistStats = catalog?.artists || {};

  function hide() {
    box.classList.add("hidden");
    box.innerHTML = "";
  }

  function show(results) {
    box.classList.remove("hidden");
    box.innerHTML = results.map(name => {
      const songsObj = artistStats[name]?.songs || {};
      const songCount = Object.keys(songsObj).length;

      let entries = 0;
      for (const k of Object.keys(songsObj)) {
        const hist = dedupHistory(songsObj[k]?.history || []);
        entries += hist.length;
      }

      return `
        <div class="searchItem" data-artist="${escapeHtml(name)}">
          <div class="name">${escapeHtml(name)}</div>
          <div class="meta">${songCount} song(s) • ${entries} chart entry(s)</div>
        </div>
      `;
    }).join("");

    box.querySelectorAll(".searchItem").forEach(el => {
      el.addEventListener("click", () => {
        const a = el.getAttribute("data-artist");
        if (!a) return;
        location.href = artistUrl(a);
      });
    });
  }

  function filter(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const starts = [];
    const includes = [];
    for (const a of artists) {
      const low = a.toLowerCase();
      if (low.startsWith(s)) starts.push(a);
      else if (low.includes(s)) includes.push(a);
    }
    return [...starts, ...includes].slice(0, 10);
  }

  input.addEventListener("input", () => {
    const results = filter(input.value);
    if (results.length === 0) hide();
    else show(results);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
    if (e.key === "Enter") {
      const results = filter(input.value);
      if (results.length > 0) location.href = artistUrl(results[0]);
    }
  });

  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) hide();
  });

  input.addEventListener("focus", () => {
    const results = filter(input.value);
    if (results.length > 0) show(results);
  });
}

/* ===========================
   Weekly Awards (inline labels)
   =========================== */

function movementValue(entry) {
  if (entry.movement && typeof entry.movement.type === "string") {
    const t = entry.movement.type;
    const v = Number(entry.movement.value || 0);
    return { type: t, value: v };
  }
  const lw = (entry.lastWeek === null || entry.lastWeek === undefined) ? null : Number(entry.lastWeek);
  const r = Number(entry.rank);
  if (lw === null || Number.isNaN(lw)) return { type: "unknown", value: 0 };
  const diff = lw - r;
  if (diff > 0) return { type: "up", value: diff };
  if (diff < 0) return { type: "down", value: Math.abs(diff) };
  return { type: "stay", value: 0 };
}

function computeAwardsMap(entries, songLookup, asOfWeek) {
  const out = new Map();
  function addAward(entry, text, cls) {
    if (!entry) return;
    const k = songKey(entry.title, entry.artist);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push({ text, cls });
  }

  let biggestJump = null, bestUp = -1;
  for (const e of entries) {
    const m = movementValue(e);
    if (m.type === "up" && m.value > bestUp) { bestUp = m.value; biggestJump = e; }
    else if (m.type === "up" && m.value === bestUp && biggestJump && Number(e.rank) < Number(biggestJump.rank)) biggestJump = e;
  }

  let biggestFall = null, bestDown = -1;
  for (const e of entries) {
    const m = movementValue(e);
    if (m.type === "down" && m.value > bestDown) { bestDown = m.value; biggestFall = e; }
    else if (m.type === "down" && m.value === bestDown && biggestFall && Number(e.rank) < Number(biggestFall.rank)) biggestFall = e;
  }

  const hotShotDebut = entries
    .filter(e => e.movement?.type === "new")
    .sort((a, b) => Number(a.rank) - Number(b.rank))[0] || null;

  const hotShotReentry = entries
    .filter(e => e.movement?.type === "re")
    .sort((a, b) => Number(a.rank) - Number(b.rank))[0] || null;

  let longest = null, maxWeeks = -1;
  for (const e of entries) {
    const k = songKey(e.title, e.artist);
    const songObj = songLookup.get(k) || null;
    const asof = songObj ? statsAsOf(songObj, asOfWeek) : { weeks: e.weeks ?? 0 };
    const w = Number(asof.weeks || 0);
    if (w > maxWeeks) { maxWeeks = w; longest = e; }
    else if (w === maxWeeks && longest && Number(e.rank) < Number(longest.rank)) longest = e;
  }

  if (biggestJump) addAward(biggestJump, `Biggest Jump (+${bestUp})`, "awardJump");
  if (biggestFall) addAward(biggestFall, `Biggest Fall (-${bestDown})`, "awardFall");
  if (hotShotDebut) addAward(hotShotDebut, "Hot Shot Debut", "awardDebut");
  if (hotShotReentry) addAward(hotShotReentry, "Hot Shot Re-Entry", "awardReentry");
  if (longest) addAward(longest, `Longest Chart Sitter (${maxWeeks} wks)`, "awardSitter");

  return out;
}

function renderAwardsLine(awardsForSong) {
  if (!awardsForSong || awardsForSong.length === 0) return "";
  return `
    <div class="awardLine">
      ${awardsForSong.map(a => `<span class="awardText ${a.cls}">${escapeHtml(a.text)}</span>`).join(" • ")}
    </div>
  `;
}

/* ===========================
   Main
   =========================== */

async function main() {
  const manifest = await loadJSON("data/manifest.json");
  const weeks = manifest.weeks || []; // newest -> oldest

  const requested = qs("week");
  const weekToLoad = (requested && weeks.includes(requested))
    ? requested
    : (weeks[0] || null);

  // Week dropdown
  const sel = document.getElementById("weekSelect");
  sel.innerHTML = weeks.map(w => `<option value="${w}">${w}</option>`).join("");
  if (weekToLoad) sel.value = weekToLoad;
  sel.addEventListener("change", () => setWeekParam(sel.value));

  // Catalog
  const catalog = await loadJSON("data/catalog.json");
  setupArtistSearch(catalog);

  // Build lookups
  const songLookup = new Map();      // exact key
  const songLookupCanon = new Map(); // canonical fallback (only if unique)

  for (const [, artistObj] of Object.entries(catalog.artists || {})) {
    const songs = artistObj.songs || {};
    for (const [skey, songObj] of Object.entries(songs)) {
      const exact = skey.toLowerCase().trim();
      songLookup.set(exact, songObj);

      // canonical map: only store if unique to avoid wrong matches
      const parts = exact.split(" - ");
      if (parts.length >= 2) {
        const a = parts[0];
        const t = parts.slice(1).join(" - ");
        const ck = `${canon(a)} - ${canon(t)}`;
        if (!songLookupCanon.has(ck)) songLookupCanon.set(ck, songObj);
        else songLookupCanon.set(ck, null); // mark ambiguous
      }
    }
  }

  function findCatalogSong(entry) {
    const k = songKey(entry.title, entry.artist);
    const hit = songLookup.get(k);
    if (hit) return hit;

    const ck = canonKey(entry.title, entry.artist);
    const hit2 = songLookupCanon.get(ck);
    return hit2 || null; // null if ambiguous or missing
  }

  // Load week chart JSON
  const chart = weekToLoad
    ? await loadJSON(`data/${weekToLoad}.json`)
    : await loadJSON("data/latest.json");

  document.getElementById("chartTitle").textContent = chart.chartName || "Hot 100";
  document.getElementById("weekLabel").textContent = `Week of ${chart.week}`;
  document.getElementById("footInfo").textContent =
    `Showing ${chart.entries.length} entries • Archive: ${weeks.length} week(s)`;

  const list = document.getElementById("chart");
  const asOfWeek = chart.week;
  const prevWeekStr = getPrevWeek(weeks, asOfWeek);

  // Awards map this week
  // For awards we still key by exact songKey; that’s fine visually.
  const awardsMap = computeAwardsMap(chart.entries, songLookup, asOfWeek);

  list.innerHTML = chart.entries.map(e => {
    const mv = moveLabel(e.movement);
    const skey = songKey(e.title, e.artist);
    const ariaId = `exp_${e.rank}`;

    const catalogSong = findCatalogSong(e);

    // Cover fallback: entry.cover -> catalogSong.cover -> placeholder
    const cover =
      (e.cover && String(e.cover).trim())
        ? String(e.cover).trim()
        : (catalogSong?.cover && String(catalogSong.cover).trim())
          ? String(catalogSong.cover).trim()
          : PLACEHOLDER;

    // as-of peak/weeks
    let peakDisplay = e.peak;
    let weeksDisplay = e.weeks;
    if (catalogSong) {
      const asof = statsAsOf(catalogSong, asOfWeek);
      if (asof.peak !== null) peakDisplay = asof.peak;
      if (asof.weeks !== null) weeksDisplay = asof.weeks;
    }

    // LW: NEW/RE => —, else only immediately previous week
    const mtype = e.movement?.type || null;
    let lwDisplay = null;
    if (mtype !== "new" && mtype !== "re" && catalogSong) {
      const lwRank = lastWeekRankImmediate(catalogSong, prevWeekStr);
      lwDisplay = (lwRank === null || Number.isNaN(lwRank)) ? null : lwRank;
    } else {
      lwDisplay = null;
    }

    const awardsLine = renderAwardsLine(awardsMap.get(skey));

    return `
      <li class="row" data-songkey="${escapeHtml(skey)}" data-rank="${escapeHtml(e.rank)}">
        <div class="rowTop" tabindex="0" role="button" aria-expanded="false" aria-controls="${ariaId}">
          <div class="rankbox">
            <div class="rank">${escapeHtml(e.rank)}</div>
            <div class="move ${mv.cls}">${escapeHtml(mv.text)}</div>
          </div>

          <div class="songRow">
            <img class="cover" src="${escapeHtml(cover)}" alt="" loading="lazy" />
            <div class="song">
              <div class="titleline">${escapeHtml(e.title)}</div>
              <div class="artist">
                <a href="${artistUrl(e.artist)}" onclick="event.stopPropagation()">${escapeHtml(e.artist)}</a>
              </div>
              ${awardsLine}
            </div>
          </div>

          <div class="stats3">
            <span>LW <b>${escapeHtml(fmtRankOrDash(lwDisplay))}</b></span>
            <span>Peak <b>${escapeHtml(fmtRankOrDash(peakDisplay))}</b></span>
            <span>Weeks <b>${escapeHtml(fmtRankOrDash(weeksDisplay))}</b></span>
          </div>
        </div>

        <div class="expand" id="${ariaId}"></div>
      </li>
    `;
  }).join("");

  attachImgFallback(list);

  function toggleRow(row) {
    const top = row.querySelector(".rowTop");
    const exp = row.querySelector(".expand");
    if (!top || !exp) return;

    const isOpen = row.classList.contains("open");
    if (isOpen) {
      row.classList.remove("open");
      top.setAttribute("aria-expanded", "false");
      exp.innerHTML = "";
      return;
    }

    document.querySelectorAll(".row.open").forEach(other => {
      if (other === row) return;
      const otherTop = other.querySelector(".rowTop");
      const otherExp = other.querySelector(".expand");
      other.classList.remove("open");
      if (otherTop) otherTop.setAttribute("aria-expanded", "false");
      if (otherExp) otherExp.innerHTML = "";
    });

    row.classList.add("open");
    top.setAttribute("aria-expanded", "true");

    const rank = Number(row.getAttribute("data-rank") || "0");
    const entry = chart.entries.find(x => Number(x.rank) === rank);
    if (!entry) {
      exp.innerHTML = `<div class="expandInner">Could not find entry.</div>`;
      return;
    }

    const catalogSong = (function () {
      // use the same matcher used for rows
      // (recompute here to keep it simple)
      // exact -> canonical -> null
      const k = songKey(entry.title, entry.artist);
      const hit = songLookup.get(k);
      if (hit) return hit;
      const ck = canonKey(entry.title, entry.artist);
      const hit2 = songLookupCanon.get(ck);
      return hit2 || null;
    })();

    const entryWithWeek = { ...entry, _week: chart.week };
    exp.innerHTML = buildExpandHtml(entryWithWeek, catalogSong, asOfWeek, prevWeekStr);
  }

  list.querySelectorAll(".row").forEach(row => {
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
}

main().catch(err => {
  console.error(err);
  alert(err.message);
});
