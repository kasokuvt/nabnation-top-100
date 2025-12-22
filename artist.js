const PLACEHOLDER = "covers/_placeholder.png";

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return await res.json();
}

function esc(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function artistUrl(artistName) {
  return `artist.html?name=${encodeURIComponent(artistName)}`;
}

function weekUrl(weekStr) {
  return `/?week=${encodeURIComponent(weekStr)}`;
}

function attachImgFallback(root) {
  root.querySelectorAll("img.cover").forEach(img => {
    img.addEventListener("error", () => {
      if (img.src.includes(PLACEHOLDER)) return;
      img.src = PLACEHOLDER;
    });
  });
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
      let entries = 0;
      for (const k of Object.keys(songsObj)) entries += (songsObj[k]?.history?.length || 0);

      return `
        <div class="searchItem" data-artist="${esc(name)}">
          <div class="name">${esc(name)}</div>
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

function computeStatsFromHistory(history) {
  const h = Array.isArray(history) ? history : [];
  if (h.length === 0) {
    return { debut: "—", peakPos: "—", peakDate: "—", weeks: 0, rows: [] };
  }

  // sort oldest->newest by week string (YYYY-MM-DD)
  const sorted = [...h].sort((a, b) => String(a.week).localeCompare(String(b.week)) || (a.rank - b.rank));

  const debut = sorted[0].week;

  // peak pos is min rank
  let peakPos = sorted[0].rank;
  for (const r of sorted) peakPos = Math.min(peakPos, r.rank);

  // peak date = earliest week where rank == peakPos
  let peakDate = sorted.find(r => r.rank === peakPos)?.week || sorted[0].week;

  const weeks = sorted.length;

  // For expand panel we want newest->oldest
  const newestFirst = [...sorted].sort((a, b) => String(b.week).localeCompare(String(a.week)) || (a.rank - b.rank));

  return { debut, peakPos, peakDate, weeks, rows: newestFirst };
}

function buildHistoryHtml(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="history"><div class="historyRow"><span>No history yet.</span></div></div>`;
  }

  return `
    <div class="history">
      ${rows.map(h => `
        <div class="historyRow">
          <span><a href="${weekUrl(h.week)}">${esc(h.week)}</a></span>
          <span>Rank <b>#${esc(h.rank)}</b></span>
        </div>
      `).join("")}
    </div>
  `;
}

function rowHtml(songId, song, artistName, stats) {
  const cover = song.cover ? esc(song.cover) : PLACEHOLDER;

  return `
    <div class="aRow" data-songid="${esc(songId)}">
      <div class="aRowTop" tabindex="0" role="button" aria-expanded="false" aria-controls="exp_${esc(songId)}">
        <div class="aSongCell">
          <img class="cover" src="${cover}" alt="" loading="lazy" />
          <div class="aSongText">
            <div class="aSongTitle">${esc(song.title)}</div>
            <div class="aSongArtist">
              <a href="${artistUrl(artistName)}" onclick="event.stopPropagation()">${esc(artistName)}</a>
            </div>
          </div>
        </div>

        <div class="aCell center">${esc(stats.debut)}</div>
        <div class="aCell center"><b class="strong">#${esc(stats.peakPos)}</b></div>
        <div class="aCell center">${esc(stats.peakDate)}</div>
        <div class="aCell center"><b class="strong">${esc(stats.weeks)}</b></div>
      </div>

      <div class="expand" id="exp_${esc(songId)}"></div>
    </div>
  `;
}

async function main() {
  const name = qs("name");
  if (!name) throw new Error("Missing ?name= in URL");

  const catalog = await loadJSON("data/catalog.json");
  setupArtistSearch(catalog);

  const artist = catalog.artists?.[name];
  if (!artist) throw new Error("Artist not found in catalog yet (they may not have charted).");

  document.getElementById("artistName").textContent = name;

  const songsObj = artist.songs || {};
  const songEntries = Object.entries(songsObj).map(([id, s]) => ({ id, ...s }));

  // compute stats and sort like a chart: best peak first, then weeks desc, then title
  const computed = songEntries.map(s => {
    const stats = computeStatsFromHistory(s.history);
    return { ...s, stats };
  });

  computed.sort((a, b) =>
    (a.stats.peakPos - b.stats.peakPos) ||
    (b.stats.weeks - a.stats.weeks) ||
    String(a.title).localeCompare(String(b.title))
  );

  // Header meta line
  const totalSongs = computed.length;
  const totalWeeks = computed.reduce((acc, s) => acc + (s.stats.weeks || 0), 0);
  const bestPeak = computed.length ? computed[0].stats.peakPos : "—";
  document.getElementById("artistMeta").textContent =
    `${totalSongs} song(s) charted • ${totalWeeks} total chart entries • Best peak: #${bestPeak}`;

  // Render table
  const table = document.getElementById("artistTable");
  table.innerHTML = computed.map(s => rowHtml(s.id, s, name, s.stats)).join("");
  attachImgFallback(table);

  // Expand/collapse behavior (same style as main chart page)
  function closeAllExcept(row) {
    document.querySelectorAll(".aRow.open").forEach(other => {
      if (other === row) return;
      const top = other.querySelector(".aRowTop");
      const exp = other.querySelector(".expand");
      other.classList.remove("open");
      if (top) top.setAttribute("aria-expanded", "false");
      if (exp) exp.innerHTML = "";
    });
  }

  function toggleRow(row) {
    const top = row.querySelector(".aRowTop");
    const exp = row.querySelector(".expand");
    if (!top || !exp) return;

    const isOpen = row.classList.contains("open");
    if (isOpen) {
      row.classList.remove("open");
      top.setAttribute("aria-expanded", "false");
      exp.innerHTML = "";
      return;
    }

    closeAllExcept(row);

    row.classList.add("open");
    top.setAttribute("aria-expanded", "true");

    const songId = row.getAttribute("data-songid");
    const song = songsObj[songId];
    const stats = computeStatsFromHistory(song?.history || []);

    exp.innerHTML = `
      <div class="expandInner">
        <div class="expandTop">
          <div>
            <div class="expandTitle">${esc(song?.title || "Song")}</div>
            <div class="expandSub">
              <a href="${artistUrl(name)}" style="color:inherit; text-decoration:none; border-bottom:1px solid rgba(244,246,251,.25)">
                ${esc(name)}
              </a>
            </div>
            <div class="pills" style="margin-top:10px">
              <span>Debut <b>${esc(stats.debut)}</b></span>
              <span>Peak <b>#${esc(stats.peakPos)}</b></span>
              <span>Peak Date <b>${esc(stats.peakDate)}</b></span>
              <span>Weeks <b>${esc(stats.weeks)}</b></span>
            </div>
            <div class="expandLinks">
              <a href="${artistUrl(name)}">Refresh artist page</a>
              <a href="/">Back to chart</a>
            </div>
          </div>
        </div>

        ${buildHistoryHtml(stats.rows)}
      </div>
    `;
  }

  table.querySelectorAll(".aRow").forEach(row => {
    const top = row.querySelector(".aRowTop");
    if (!top) return;

    top.addEventListener("click", () => toggleRow(row));
    top.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleRow(row);
      }
    });
  });

  // Song filter (live)
  const filterInput = document.getElementById("songFilter");
  const countLabel = document.getElementById("countLabel");
  function updateCount() {
    const visible = [...table.querySelectorAll(".aRow")].filter(r => r.style.display !== "none").length;
    countLabel.textContent = `${visible} / ${computed.length} shown`;
  }

  filterInput.addEventListener("input", () => {
    const q = filterInput.value.trim().toLowerCase();
    // close everything on filter change
    closeAllExcept(null);

    table.querySelectorAll(".aRow").forEach(row => {
      const id = row.getAttribute("data-songid");
      const s = songsObj[id];
      const hay = `${s?.title || ""} ${name}`.toLowerCase();
      row.style.display = (!q || hay.includes(q)) ? "" : "none";
    });
    updateCount();
  });

  updateCount();
}

main().catch(err => {
  console.error(err);
  alert(err.message);
});
