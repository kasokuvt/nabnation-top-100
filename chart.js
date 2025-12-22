const PLACEHOLDER = "covers/_placeholder.png";

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

function moveLabel(m) {
  if (!m) return { text: "—", cls: "" };
  if (m.type === "up") return { text: `▲ ${m.value}`, cls: "up" };
  if (m.type === "down") return { text: `▼ ${m.value}`, cls: "down" };
  if (m.type === "new") return { text: "NEW", cls: "new" };
  if (m.type === "re") return { text: "RE", cls: "re" };
  if (m.type === "stay") return { text: "•", cls: "" };
  return { text: "—", cls: "" };
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
  // must match Python exporter: "{artist} - {title}".lower()
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

/* ===========================
   AS-OF STATS (the fix)
   =========================== */

function statsAsOf(songObj, weekStr) {
  // returns { peak, weeks } computed up to and including weekStr
  if (!songObj || !Array.isArray(songObj.history)) {
    return { peak: null, weeks: null };
  }
  const upTo = songObj.history.filter(h => String(h.week) <= String(weekStr));
  if (!upTo.length) return { peak: null, weeks: 0 };
  const peak = Math.min(...upTo.map(h => Number(h.rank)));
  return { peak, weeks: upTo.length };
}

function lastWeekRankAsOf(songObj, weekStr) {
  if (!songObj || !Array.isArray(songObj.history)) return null;
  const prev = songObj.history
    .filter(h => String(h.week) < String(weekStr))
    .sort((a, b) => String(a.week).localeCompare(String(b.week)))
    .pop();
  return prev ? Number(prev.rank) : null;
}

function buildHistoryHtml(history) {
  if (!history || history.length === 0) {
    return `<div class="history"><div class="historyRow"><span>No history yet.</span></div></div>`;
  }

  // Sort newest -> oldest by week string (YYYY-MM-DD)
  const rows = [...history].sort((a, b) =>
    String(b.week).localeCompare(String(a.week)) || (a.rank - b.rank)
  );

  return `
    <div class="history">
      ${rows.map(h => `
        <div class="historyRow">
          <span>
            <a href="${weekUrl(h.week)}">${escapeHtml(h.week)}</a>
          </span>
          <span>Rank <b>#${escapeHtml(h.rank)}</b></span>
        </div>
      `).join("")}
    </div>
  `;
}

function buildExpandHtml(entry, catalogSong, asOfWeek) {
  // ✅ compute as-of stats for the selected week
  let lw = entry.lastWeek;
  let peak = entry.peak;
  let weeks = entry.weeks;
  let history = catalogSong?.history ?? [];

  if (catalogSong && asOfWeek) {
    const asof = statsAsOf(catalogSong, asOfWeek);
    const lwRank = lastWeekRankAsOf(catalogSong, asOfWeek);

    if (asof.peak !== null) peak = asof.peak;
    if (asof.weeks !== null) weeks = asof.weeks;
    lw = (lwRank === null || Number.isNaN(lwRank)) ? null : lwRank;
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

      ${buildHistoryHtml(history)}
    </div>
  `;
}

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
      // total entries (appearances)
      let entries = 0;
      for (const k of Object.keys(songsObj)) {
        entries += (songsObj[k]?.history?.length || 0);
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
    // startswith matches first, then includes
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

  // click outside closes
  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== input) hide();
  });

  input.addEventListener("focus", () => {
    const results = filter(input.value);
    if (results.length > 0) show(results);
  });
}

async function main() {
  // Load manifest (weeks list)
  const manifest = await loadJSON("data/manifest.json");
  const weeks = manifest.weeks || [];
  const requested = qs("week");

  const weekToLoad = (requested && weeks.includes(requested))
    ? requested
    : (weeks[0] || null);

  // Populate week dropdown
  const sel = document.getElementById("weekSelect");
  sel.innerHTML = weeks.map(w => `<option value="${w}">${w}</option>`).join("");
  if (weekToLoad) sel.value = weekToLoad;
  sel.addEventListener("change", () => setWeekParam(sel.value));

  // Load catalog (for artist search + song history)
  const catalog = await loadJSON("data/catalog.json");
  setupArtistSearch(catalog);

  // Build a song lookup from catalog:
  // catalog.artists[artist].songs[songKey] -> {history, peak, weeks, ...}
  const songLookup = new Map();
  for (const [, artistObj] of Object.entries(catalog.artists || {})) {
    const songs = artistObj.songs || {};
    for (const [skey, songObj] of Object.entries(songs)) {
      songLookup.set(skey.toLowerCase().trim(), songObj);
    }
  }

  // Load chart week JSON
  const chart = weekToLoad
    ? await loadJSON(`data/${weekToLoad}.json`)
    : await loadJSON("data/latest.json");

  document.getElementById("chartTitle").textContent = chart.chartName || "Hot 100";
  document.getElementById("weekLabel").textContent = `Week of ${chart.week}`;
  document.getElementById("footInfo").textContent =
    `Showing ${chart.entries.length} entries • Archive: ${weeks.length} week(s)`;

  const list = document.getElementById("chart");

  const asOfWeek = chart.week;

  // Render rows (each row has a collapsible expand section)
  list.innerHTML = chart.entries.map(e => {
    const mv = moveLabel(e.movement);
    const cover = e.cover ? escapeHtml(e.cover) : PLACEHOLDER;
    const skey = songKey(e.title, e.artist);
    const ariaId = `exp_${e.rank}`;

    // ✅ compute as-of stats for THIS week from catalog history (when available)
    const catalogSong = songLookup.get(skey) || null;

    let lwDisplay = e.lastWeek;
    let peakDisplay = e.peak;
    let weeksDisplay = e.weeks;

    if (catalogSong) {
      const asof = statsAsOf(catalogSong, asOfWeek);
      const lwRank = lastWeekRankAsOf(catalogSong, asOfWeek);

      if (asof.peak !== null) peakDisplay = asof.peak;
      if (asof.weeks !== null) weeksDisplay = asof.weeks;
      lwDisplay = (lwRank === null || Number.isNaN(lwRank)) ? null : lwRank;
    }

    return `
      <li class="row" data-songkey="${escapeHtml(skey)}" data-rank="${escapeHtml(e.rank)}">
        <div class="rowTop" tabindex="0" role="button" aria-expanded="false" aria-controls="${ariaId}">
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

  // click-to-expand logic (build expand content on demand)
  function toggleRow(row) {
    const top = row.querySelector(".rowTop");
    const exp = row.querySelector(".expand");
    if (!top || !exp) return;

    const isOpen = row.classList.contains("open");
    // close
    if (isOpen) {
      row.classList.remove("open");
      top.setAttribute("aria-expanded", "false");
      exp.innerHTML = "";
      return;
    }

    // open (close others for a clean “accordion” feel)
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

    const skey = (row.getAttribute("data-songkey") || "").toLowerCase().trim();
    const rank = Number(row.getAttribute("data-rank") || "0");

    const entry = chart.entries.find(x => Number(x.rank) === rank);
    if (!entry) {
      exp.innerHTML = `<div class="expandInner">Could not find entry.</div>`;
      return;
    }

    const catalogSong = songLookup.get(skey) || null;
    const entryWithWeek = { ...entry, _week: chart.week };

    exp.innerHTML = buildExpandHtml(entryWithWeek, catalogSong, asOfWeek);
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
