const PLACEHOLDER = "covers/_placeholder.png";

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function escapeHtml(str) {
  return String(str ?? "")
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

function normalizeKey(s) {
  return String(s ?? "").toLowerCase().trim();
}

function songKey(title, artist) {
  // Must match your exporter’s key style (case-insensitive map handles minor differences)
  return normalizeKey(`${artist} — ${title}`);
}

function artistSlug(artist) {
  // Keep whatever your site expects; this matches the usual earlier setup:
  return encodeURIComponent(String(artist ?? "").trim());
}

function artistUrl(artist) {
  return `artist.html?artist=${artistSlug(artist)}`;
}

function weekUrl(week) {
  return `index.html?week=${encodeURIComponent(week)}`;
}

function setWeekParam(week) {
  const url = new URL(location.href);
  url.searchParams.set("week", week);
  location.href = url.toString();
}

function attachCoverFallback(root) {
  root.querySelectorAll("img.cover").forEach(img => {
    img.addEventListener("error", () => {
      if (img.src.includes(PLACEHOLDER)) return;
      img.src = PLACEHOLDER;
    });
  });
}

function parsePointsFromCoverFilename(coverPath) {
  // Your older covers sometimes embed points like: artist_2120_pts__title.png
  const s = String(coverPath ?? "");
  const m = s.match(/_([0-9]+(?:\.[0-9]+)?)_pts__/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function moveLabelFromComputed(movement) {
  // movement: { type: 'up'|'down'|'new'|'re'|'same', value: number|null }
  if (!movement) return { text: "—", cls: "" };

  if (movement.type === "up") return { text: `▲ ${movement.value}`, cls: "up" };
  if (movement.type === "down") return { text: `▼ ${movement.value}`, cls: "down" };
  if (movement.type === "new") return { text: "NEW", cls: "new" };
  if (movement.type === "re") return { text: "RE", cls: "re" };
  if (movement.type === "same") return { text: "—", cls: "same" };

  return { text: "—", cls: "" };
}

function buildHistoryHtml(history) {
  if (!history || history.length === 0) {
    return `<div class="history"><div class="historyRow"><span>No history yet.</span></div></div>`;
  }

  // newest -> oldest
  const rows = [...history].sort((a, b) => String(b.week).localeCompare(String(a.week)));

  return `
    <div class="history">
      ${rows
        .map(r => {
          const w = escapeHtml(r.week);
          const rk = escapeHtml(`#${r.rank}`);
          return `
            <div class="historyRow">
              <div class="historyWeek">${w}</div>
              <div class="historyRank">Rank <b>${rk}</b></div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildExpandedHtml(entry, computed, songObj, currentWeek) {
  const title = escapeHtml(entry.title);
  const artist = escapeHtml(entry.artist);

  const lwDisplay = computed.isReentry || computed.isNew ? "—" : (computed.lastWeekRank ?? "—");
  const peakRank = computed.peakRank ?? entry.rank;
  const weeksOn = computed.weeksOnChart ?? 1;

  const history = (songObj?.history || []).filter(h => String(h.week) <= String(currentWeek));

  return `
    <div class="expandInner">
      <div class="expandTop">
        <div class="expandTitle">${title}</div>
        <div class="expandArtist">
          <a href="${artistUrl(entry.artist)}" onclick="event.stopPropagation()">${artist}</a>
        </div>

        <div class="expandStats">
          <span class="muted">LW</span> <b>${escapeHtml(lwDisplay)}</b>
          <span class="muted">&nbsp;&nbsp;Peak</span> <b>${escapeHtml(peakRank)}</b>
          <span class="muted">&nbsp;&nbsp;Weeks</span> <b>${escapeHtml(weeksOn)}</b>
        </div>

        <div class="expandLinks">
          <a href="${artistUrl(entry.artist)}">Open artist page</a>
          <a href="${weekUrl(currentWeek)}">Open this week</a>
        </div>
      </div>

      ${buildHistoryHtml(history)}
    </div>
  `;
}

function setupArtistSearch(catalog) {
  const input = document.getElementById("artistSearch");
  const results = document.getElementById("artistResults");
  if (!input || !results) return;

  const artists = Object.keys(catalog.artists || {});

  input.addEventListener("input", () => {
    const q = normalizeKey(input.value);
    results.innerHTML = "";
    if (!q) return;

    const hits = artists
      .filter(a => normalizeKey(a).includes(q))
      .slice(0, 12);

    for (const name of hits) {
      const obj = catalog.artists[name] || {};
      const songCount = Object.keys(obj.songs || {}).length;
      const entryCount = obj.totalEntries ?? obj.entries ?? obj.totalChartEntries ?? null;

      const li = document.createElement("div");
      li.className = "artistHit";
      li.innerHTML = `
        <div class="artistHitName">${escapeHtml(name)}</div>
        <div class="artistHitMeta">${escapeHtml(songCount)} song(s) • ${escapeHtml(entryCount ?? "—")} chart entry(s)</div>
      `;
      li.addEventListener("click", () => {
        location.href = artistUrl(name);
      });
      results.appendChild(li);
    }
  });
}

function computeStatsAsOfWeek(songHistory, currentWeek) {
  // history items look like: { week: "YYYY-MM-DD", rank: number }
  const upto = (songHistory || [])
    .filter(h => String(h.week) <= String(currentWeek))
    .sort((a, b) => String(a.week).localeCompare(String(b.week))); // oldest->newest

  const weeksOnChart = upto.length;
  if (weeksOnChart === 0) {
    return {
      weeksOnChart: 0,
      peakRank: null,
      peakWeek: null,
      lastWeekRank: null,
      wasEverOnBefore: false,
      prevWeekRank: null
    };
  }

  let peakRank = Infinity;
  let peakWeek = null;
  for (const h of upto) {
    if (Number(h.rank) < peakRank) {
      peakRank = Number(h.rank);
      peakWeek = h.week;
    }
  }

  const current = upto[upto.length - 1];
  const prev = upto.length >= 2 ? upto[upto.length - 2] : null;

  return {
    weeksOnChart,
    peakRank: Number.isFinite(peakRank) ? peakRank : null,
    peakWeek,
    lastWeekRank: prev ? Number(prev.rank) : null,
    wasEverOnBefore: weeksOnChart >= 2, // before the current week
    prevWeekRank: prev ? Number(prev.rank) : null,
    currentRank: Number(current.rank)
  };
}

function computeMovement(currentRank, lastWeekRank, isNew, isReentry) {
  if (isReentry) return { type: "re", value: null };
  if (isNew) return { type: "new", value: null };
  if (lastWeekRank == null) return { type: "same", value: null };

  const delta = lastWeekRank - currentRank;
  if (delta > 0) return { type: "up", value: delta };
  if (delta < 0) return { type: "down", value: Math.abs(delta) };
  return { type: "same", value: null };
}

function computeAwards(entriesComputed) {
  // entriesComputed: [{ skey, title, artist, rank, movement, isNew, isReentry, lastWeekRank, weeksOnChart }]
  // Return map skey -> [award strings...]
  const awards = new Map();

  function add(skey, label) {
    if (!awards.has(skey)) awards.set(skey, []);
    awards.get(skey).push(label);
  }

  // Biggest jump (largest positive delta)
  let bestJump = null;
  for (const e of entriesComputed) {
    if (e.movement?.type === "up" && Number.isFinite(e.movement.value)) {
      if (!bestJump || e.movement.value > bestJump.movement.value) bestJump = e;
    }
  }
  if (bestJump) add(bestJump.skey, `Biggest Jump (+${bestJump.movement.value})`);

  // Biggest fall (largest negative delta)
  let bestFall = null;
  for (const e of entriesComputed) {
    if (e.movement?.type === "down" && Number.isFinite(e.movement.value)) {
      if (!bestFall || e.movement.value > bestFall.movement.value) bestFall = e;
    }
  }
  if (bestFall) add(bestFall.skey, `Biggest Fall (-${bestFall.movement.value})`);

  // Hot shot debut (best rank among new songs)
  let hotDebut = null;
  for (const e of entriesComputed) {
    if (e.isNew) {
      if (!hotDebut || e.rank < hotDebut.rank) hotDebut = e;
    }
  }
  if (hotDebut) add(hotDebut.skey, `Hot Shot Debut (#${hotDebut.rank})`);

  // Hot shot reentry (best rank among re-entries)
  let hotRe = null;
  for (const e of entriesComputed) {
    if (e.isReentry) {
      if (!hotRe || e.rank < hotRe.rank) hotRe = e;
    }
  }
  if (hotRe) add(hotRe.skey, `Hot Shot Re-entry (#${hotRe.rank})`);

  // Longest chart sitter (max weeks-on-chart as-of this week)
  let longest = null;
  for (const e of entriesComputed) {
    if (!Number.isFinite(e.weeksOnChart)) continue;
    if (!longest || e.weeksOnChart > longest.weeksOnChart) longest = e;
  }
  if (longest) add(longest.skey, `Longest Chart Sitter (${longest.weeksOnChart} weeks)`);

  return awards;
}

async function main() {
  const list = document.getElementById("chartList");
  const sel = document.getElementById("weekSelect");
  const titleEl = document.getElementById("chartTitle");
  const weekLabelEl = document.getElementById("weekLabel");

  // Load manifest (weeks list + latest)
  const manifest = await loadJSON("data/manifest.json");
  const weeks = (manifest.weeks || []).slice().sort((a, b) => String(b).localeCompare(String(a))); // newest->oldest
  const latestWeek = manifest.latest || weeks[0];
  const selectedWeek = qs("week") || latestWeek;

  // Fill dropdown
  if (sel) {
    sel.innerHTML = weeks.map(w => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`).join("");
    sel.value = selectedWeek;
    sel.addEventListener("change", () => setWeekParam(sel.value));
  }

  // Header labels
  if (titleEl) titleEl.textContent = manifest.chartName || "Nabnation Top 100";
  if (weekLabelEl) weekLabelEl.textContent = `Week of ${selectedWeek}`;

  // Load catalog (artist search + per-song history + better covers)
  const catalog = await loadJSON("data/catalog.json");
  setupArtistSearch(catalog);

  // Build song lookup from catalog (case-insensitive)
  // catalog.artists[artist].songs[skey] -> songObj with history, cover, etc.
  const songLookup = new Map();
  for (const [, artistObj] of Object.entries(catalog.artists || {})) {
    const songs = artistObj?.songs || {};
    for (const [skey, songObj] of Object.entries(songs)) {
      songLookup.set(normalizeKey(skey), songObj);
    }
  }

  // Load selected week JSON
  const chart = await loadJSON(`data/${selectedWeek}.json`);

  // Prepare computed entries (fix stats per-week + fix RE LW)
  const computedEntries = chart.entries.map(e => {
    const skey = songKey(e.title, e.artist);
    const songObj = songLookup.get(normalizeKey(skey));

    const hist = songObj?.history || [];
    const stats = computeStatsAsOfWeek(hist, selectedWeek);

    // Determine "new vs re-entry":
    // - If the song has no earlier history before this week => NEW
    // - If it has history before this week but not in *immediately previous week* => RE
    // We need “previous week” string (the week right after selectedWeek in your archive order)
    const idx = weeks.indexOf(selectedWeek);
    const prevWeek = idx >= 0 && idx < weeks.length - 1 ? weeks[idx + 1] : null; // because weeks is newest->oldest
    const prevWeekRank = prevWeek
      ? (hist.find(h => h.week === prevWeek)?.rank ?? null)
      : null;

    const everBeforeThisWeek = (hist || []).some(h => String(h.week) < String(selectedWeek));
    const chartedPrevWeek = prevWeekRank != null;

    const isNew = !everBeforeThisWeek;
    const isReentry = everBeforeThisWeek && !chartedPrevWeek;

    // LW display rules:
    // - NEW => LW — (always)
    // - RE  => LW — (always)
    // - otherwise => rank from immediate previous week (not “previous charted”)
    const lastWeekRankForDisplay = (!isNew && !isReentry) ? prevWeekRank : null;

    const movement = computeMovement(Number(e.rank), lastWeekRankForDisplay, isNew, isReentry);

    // Cover fallback:
    // - If week cover is missing/placeholder, use catalog cover if available
    let cover = e.cover || PLACEHOLDER;
    if (!cover || cover === PLACEHOLDER) {
      const catCover = songObj?.cover || songObj?.image || null;
      if (catCover) cover = catCover;
    }

    // Points/listeners fallback:
    // - Prefer week data if present
    // - If null, try parse points from cover filename (older exports embed it)
    let points = e.points;
    if (points == null) {
      const p = parsePointsFromCoverFilename(e.cover);
      if (p != null) points = p;
    }
    const listeners = e.listeners; // if null, leave null (don’t invent)

    // Peak/weeks MUST be as-of selected week:
    const peakRank = stats.peakRank;
    const weeksOnChart = stats.weeksOnChart;

    return {
      raw: e,
      skey,
      songObj,
      computed: {
        isNew,
        isReentry,
        lastWeekRank: lastWeekRankForDisplay,
        peakRank,
        weeksOnChart,
        movement,
        cover,
        points,
        listeners
      }
    };
  });

  // Weekly awards (colored text under song/artist)
  const awardsMap = computeAwards(
    computedEntries.map(x => ({
      skey: x.skey,
      title: x.raw.title,
      artist: x.raw.artist,
      rank: Number(x.raw.rank),
      movement: x.computed.movement,
      isNew: x.computed.isNew,
      isReentry: x.computed.isReentry,
      lastWeekRank: x.computed.lastWeekRank,
      weeksOnChart: x.computed.weeksOnChart
    }))
  );

  // Render
  if (!list) return;

  list.innerHTML = computedEntries
    .map(item => {
      const e = item.raw;
      const c = item.computed;

      const mv = moveLabelFromComputed(c.movement);
      const ariaId = `exp_${e.rank}`;

      const lwText = (c.isNew || c.isReentry) ? "—" : (c.lastWeekRank ?? "—");
      const peakText = c.peakRank ?? e.rank;
      const weeksText = c.weeksOnChart ?? 1;

      const awardLines = awardsMap.get(item.skey) || [];
      const awardHtml = awardLines.length
        ? `<div class="awardLine">${awardLines.map(a => `<span class="awardTag">${escapeHtml(a)}</span>`).join(" ")}</div>`
        : "";

      return `
        <li class="row" data-songkey="${escapeHtml(item.skey)}" data-rank="${escapeHtml(e.rank)}">
          <div class="rowTop" tabindex="0" role="button" aria-expanded="false" aria-controls="${ariaId}">
            <div class="rankbox">
              <div class="rank">${escapeHtml(e.rank)}</div>
              <div class="move ${mv.cls}">${escapeHtml(mv.text)}</div>
            </div>

            <div class="songRow">
              <img class="cover" src="${escapeHtml(c.cover)}" alt="" loading="lazy" />
              <div class="song">
                <div class="titleline">${escapeHtml(e.title)}</div>
                <div class="artist">
                  <a href="${artistUrl(e.artist)}" onclick="event.stopPropagation()">${escapeHtml(e.artist)}</a>
                </div>
                ${awardHtml}
              </div>
            </div>

            <div class="stats3">
              <div><span class="muted">LW</span> <b>${escapeHtml(lwText)}</b></div>
              <div><span class="muted">Peak</span> <b>${escapeHtml(peakText)}</b></div>
              <div><span class="muted">Weeks</span> <b>${escapeHtml(weeksText)}</b></div>
            </div>
          </div>

          <div class="rowExpand" id="${ariaId}">
            ${buildExpandedHtml(e, c, item.songObj, selectedWeek)}
          </div>
        </li>
      `;
    })
    .join("");

  attachCoverFallback(list);

  // Expand/collapse behavior
  function toggleRow(row) {
    const top = row.querySelector(".rowTop");
    const exp = row.querySelector(".rowExpand");
    const isOpen = top.getAttribute("aria-expanded") === "true";

    // close any other open rows (optional, feels cleaner on mobile)
    document.querySelectorAll(".rowTop[aria-expanded='true']").forEach(openTop => {
      if (openTop === top) return;
      openTop.setAttribute("aria-expanded", "false");
      const parent = openTop.closest(".row");
      const openExp = parent?.querySelector(".rowExpand");
      if (openExp) openExp.style.display = "none";
    });

    if (isOpen) {
      top.setAttribute("aria-expanded", "false");
      exp.style.display = "none";
    } else {
      top.setAttribute("aria-expanded", "true");
      exp.style.display = "block";
    }
  }

  list.querySelectorAll(".row").forEach(row => {
    const top = row.querySelector(".rowTop");
    const exp = row.querySelector(".rowExpand");
    if (!top || !exp) return;

    exp.style.display = "none";

    top.addEventListener("click", () => toggleRow(row));
    top.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleRow(row);
      }
    });
  });
}

main().catch(err => {
  console.error(err);
  alert(err.message);
});
