/* chart.js — Nabnation Top 100
   - Renders weekly chart rows
   - Computes LW / Peak / Weeks "as-of selected week"
   - Fixes RE entry LW display
   - Adds weekly awards as colored text under artist
   - Cleans bad artist strings that contain points/listeners
   - Robust cover placeholder fallback (GitHub Pages underscore-safe)
*/

(() => {
  "use strict";

  // -----------------------
  // Config
  // -----------------------
  const DATA_DIR = "data";
  const MANIFEST_URLS = [`${DATA_DIR}/manifest.json`, "manifest.json"];
  const LATEST_URLS = [`${DATA_DIR}/latest.json`, "latest.json"];

  const WEEK_FILE = (week) => `${DATA_DIR}/${week}.json`;

  // Placeholder handling:
  // 1) Try non-underscore placeholder first (works on GitHub Pages without .nojekyll)
  // 2) Try underscore placeholder (works if you add .nojekyll OR if your host allows it)
  // 3) Inline SVG fallback (always works)
  const PLACEHOLDER_CANDIDATES = [
    "covers/placeholder.png",
    "covers/_placeholder.png",
    "assets/placeholder.png",
  ];

  const INLINE_PLACEHOLDER_SVG =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#0b0b0f"/>
            <stop offset="1" stop-color="#1a1a24"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" rx="18" ry="18" fill="url(#g)"/>
        <path d="M20 64l14-18 12 14 10-12 20 24H20z" fill="rgba(255,255,255,0.12)"/>
        <circle cx="36" cy="34" r="6" fill="rgba(255,255,255,0.14)"/>
        <text x="50%" y="82%" text-anchor="middle"
              font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial"
              font-size="10" fill="rgba(255,255,255,0.30)">no cover</text>
      </svg>
    `);

  // Awards colors
  const AWARD_STYLES = {
    biggestJump: { label: "Biggest Jump", color: "#7CFFB2" },
    biggestFall: { label: "Biggest Fall", color: "#FF7C7C" },
    hotShotDebut: { label: "Hot Shot Debut", color: "#7CC7FF" },
    hotShotReentry: { label: "Hot Shot Re-Entry", color: "#D7B7FF" },
    longestSitter: { label: "Longest Chart Sitter", color: "#F7D36A" },
  };

  // -----------------------
  // DOM helpers
  // -----------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  };

  const setText = (node, text) => {
    if (!node) return;
    node.textContent = text;
  };

  // -----------------------
  // URL helpers
  // -----------------------
  const getParam = (key) => new URLSearchParams(location.search).get(key);
  const setParam = (key, value, { replace = true } = {}) => {
    const url = new URL(location.href);
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    if (replace) history.replaceState({}, "", url.toString());
    else history.pushState({}, "", url.toString());
  };

  // -----------------------
  // Normalization / cleaning
  // -----------------------
  const normalizeSpace = (s) => String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

  // Remove trailing junk like: "fakemink (60.0 pts) (6 listeners)* (new release)"
  // but keep normal artist names intact as much as possible.
  const cleanArtist = (raw) => {
    let s = normalizeSpace(raw);

    // Remove trailing "*" markers
    s = s.replace(/\*+$/g, "").trim();

    // Remove any trailing parentheses that include pts/listeners/new release-ish tags
    // Repeat because some strings have multiple parentheses at the end.
    while (/\)\s*$/.test(s)) {
      const m = s.match(/\s*\(([^()]*)\)\s*$/);
      if (!m) break;
      const inside = m[1].toLowerCase();
      const looksLikeJunk =
        inside.includes("pts") ||
        inside.includes("point") ||
        inside.includes("listener") ||
        inside.includes("scrobble") ||
        inside.includes("new release") ||
        inside.includes("re-release") ||
        inside.includes("re release") ||
        inside.includes("new") && inside.includes("release");

      if (!looksLikeJunk) break;
      s = s.slice(0, m.index).trim();
    }

    // Remove any remaining "(xx pts)" or "(xx listeners)" anywhere at end
    s = s
      .replace(/\s*\(\s*\d+(\.\d+)?\s*pts?\s*\)\s*$/i, "")
      .replace(/\s*\(\s*\d+\s*listeners?\s*\)\s*$/i, "")
      .trim();

    return s;
  };

  const cleanTitle = (raw) => normalizeSpace(raw);

  const songKey = (artist, title) => {
    const a = cleanArtist(artist).toLowerCase();
    const t = cleanTitle(title).toLowerCase();
    return `${a} — ${t}`;
  };

  // -----------------------
  // Fetch with fallbacks + caching
  // -----------------------
  const fetchJSONCache = new Map();

  async function fetchJSON(url) {
    if (fetchJSONCache.has(url)) return fetchJSONCache.get(url);

    const p = (async () => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      return await res.json();
    })();

    fetchJSONCache.set(url, p);
    return p;
  }

  async function fetchFirstWorking(urls) {
    let lastErr = null;
    for (const u of urls) {
      try {
        return await fetchJSON(u);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("All fetch attempts failed");
  }

  // Week file cache (week -> Promise<weekData>)
  const weekCache = new Map();

  async function loadWeek(week) {
    if (!week) throw new Error("loadWeek called with empty week");

    if (weekCache.has(week)) return weekCache.get(week);

    const p = (async () => {
      const url = WEEK_FILE(week);
      const raw = await fetchJSON(url);

      // Support both {week, entries:[...]} and plain {entries:[...]}.
      const entries = Array.isArray(raw.entries) ? raw.entries : [];
      const normalized = entries
        .map((e) => normalizeEntry(e))
        .filter((e) => e.rank != null)
        .sort((a, b) => a.rank - b.rank);

      return {
        week: raw.week || week,
        entries: normalized,
        _raw: raw,
      };
    })();

    weekCache.set(week, p);
    return p;
  }

  function normalizeEntry(e) {
    const rank = Number(e.rank);
    if (!Number.isFinite(rank)) return { ...e, rank: null };

    const title = cleanTitle(e.title);
    const artist = cleanArtist(e.artist);

    const cover = normalizeSpace(e.cover);
    const coverSafe = cover ? cover : PLACEHOLDER_CANDIDATES[0];

    // Keep existing movement if present, but we will recompute for correctness.
    return {
      ...e,
      rank,
      title,
      artist,
      cover: coverSafe,
    };
  }

  // -----------------------
  // Placeholder image fallback logic
  // -----------------------
  function attachCoverFallback(img, originalSrc) {
    const tried = new Set();
    const tryNext = () => {
      // 1) try original (if not already)
      if (originalSrc && !tried.has(originalSrc)) {
        tried.add(originalSrc);
        img.src = originalSrc;
        return;
      }

      // 2) try candidates
      for (const c of PLACEHOLDER_CANDIDATES) {
        if (!tried.has(c)) {
          tried.add(c);
          img.src = c;
          return;
        }
      }

      // 3) final inline
      img.src = INLINE_PLACEHOLDER_SVG;
    };

    img.addEventListener("error", () => {
      // if the current src failed, try another
      tryNext();
    });

    // Start with original, but if it's the underscore placeholder, prefer non-underscore first.
    const src = originalSrc || "";
    if (src.endsWith("/_placeholder.png") || src.endsWith("covers/_placeholder.png")) {
      img.src = PLACEHOLDER_CANDIDATES[0];
    } else {
      img.src = src || PLACEHOLDER_CANDIDATES[0];
    }
  }

  // -----------------------
  // Compute stats "as-of" a selected week
  // -----------------------
  async function buildStatsAsOf(weeksDesc, targetWeek) {
    const idx = weeksDesc.indexOf(targetWeek);
    if (idx === -1) {
      return { statsMap: new Map(), prevRanks: new Map(), targetEntries: [] };
    }

    const prevWeek = weeksDesc[idx + 1] || null;

    // Load target + prev first
    const target = await loadWeek(targetWeek);
    const prev = prevWeek ? await loadWeek(prevWeek) : null;

    const prevRanks = new Map();
    if (prev) {
      for (const e of prev.entries) {
        prevRanks.set(songKey(e.artist, e.title), e.rank);
      }
    }

    // Weeks up to target in chronological order (oldest -> target)
    const upToDesc = weeksDesc.slice(idx); // target, older...
    const upToChrono = [...upToDesc].reverse();

    const statsMap = new Map(); // key -> {debutWeek, peakRank, peakWeek, weeks}

    for (const w of upToChrono) {
      const wd = await loadWeek(w);
      for (const e of wd.entries) {
        const key = songKey(e.artist, e.title);
        let s = statsMap.get(key);
        if (!s) {
          s = { debutWeek: w, peakRank: e.rank, peakWeek: w, weeks: 1 };
          statsMap.set(key, s);
        } else {
          s.weeks += 1;
          if (e.rank < s.peakRank) {
            s.peakRank = e.rank;
            s.peakWeek = w;
          }
        }
      }
    }

    return { statsMap, prevRanks, targetEntries: target.entries, prevWeek };
  }

  // Movement computed from prevRanks + whether it existed before target week
  function computeMovementForEntry(entry, prevRanks, statsMap, targetWeek) {
    const key = songKey(entry.artist, entry.title);
    const prevRank = prevRanks.get(key) ?? null;

    const s = statsMap.get(key);
    const existedBefore = s ? (s.debutWeek !== targetWeek && s.weeks >= 2) : false;

    if (prevRank == null) {
      if (existedBefore) {
        return { type: "re", value: null, lastWeek: null };
      }
      return { type: "new", value: null, lastWeek: null };
    }

    const diff = prevRank - entry.rank; // positive = up
    if (diff > 0) return { type: "up", value: diff, lastWeek: prevRank };
    if (diff < 0) return { type: "down", value: Math.abs(diff), lastWeek: prevRank };
    return { type: "same", value: 0, lastWeek: prevRank };
  }

  // -----------------------
  // Weekly awards
  // -----------------------
  function computeAwards(targetEntries, prevRanks, statsMap, targetWeek) {
    const byKey = new Map(); // key -> {entry, movement, stats}
    for (const e of targetEntries) {
      const key = songKey(e.artist, e.title);
      const movement = computeMovementForEntry(e, prevRanks, statsMap, targetWeek);
      const stats = statsMap.get(key) || { debutWeek: targetWeek, peakRank: e.rank, peakWeek: targetWeek, weeks: 1 };
      byKey.set(key, { entry: e, movement, stats });
    }

    const pick = {
      biggestJump: null,
      biggestFall: null,
      hotShotDebut: null,
      hotShotReentry: null,
      longestSitter: null,
    };

    // Biggest jump / fall
    for (const [key, v] of byKey.entries()) {
      const m = v.movement;
      if (m.type === "up" && m.value > 0) {
        if (!pick.biggestJump) pick.biggestJump = { key, delta: m.value, rank: v.entry.rank };
        else if (m.value > pick.biggestJump.delta || (m.value === pick.biggestJump.delta && v.entry.rank < pick.biggestJump.rank)) {
          pick.biggestJump = { key, delta: m.value, rank: v.entry.rank };
        }
      }
      if (m.type === "down" && m.value > 0) {
        if (!pick.biggestFall) pick.biggestFall = { key, delta: m.value, rank: v.entry.rank };
        else if (m.value > pick.biggestFall.delta || (m.value === pick.biggestFall.delta && v.entry.rank < pick.biggestFall.rank)) {
          pick.biggestFall = { key, delta: m.value, rank: v.entry.rank };
        }
      }
    }

    // Hot shot debut / re-entry (best rank among that type)
    for (const [key, v] of byKey.entries()) {
      const m = v.movement;
      if (m.type === "new") {
        if (!pick.hotShotDebut || v.entry.rank < pick.hotShotDebut.rank) {
          pick.hotShotDebut = { key, rank: v.entry.rank };
        }
      }
      if (m.type === "re") {
        if (!pick.hotShotReentry || v.entry.rank < pick.hotShotReentry.rank) {
          pick.hotShotReentry = { key, rank: v.entry.rank };
        }
      }
    }

    // Longest sitter = max weeks as-of this week
    for (const [key, v] of byKey.entries()) {
      const weeks = Number(v.stats.weeks) || 1;
      if (!pick.longestSitter) pick.longestSitter = { key, weeks, rank: v.entry.rank };
      else if (weeks > pick.longestSitter.weeks || (weeks === pick.longestSitter.weeks && v.entry.rank < pick.longestSitter.rank)) {
        pick.longestSitter = { key, weeks, rank: v.entry.rank };
      }
    }

    // Build map songKey -> [awardLine...]
    const awardMap = new Map();
    const addAward = (songK, type, extraText) => {
      if (!songK) return;
      if (!awardMap.has(songK)) awardMap.set(songK, []);
      awardMap.get(songK).push({ type, extraText });
    };

    if (pick.biggestJump) addAward(pick.biggestJump.key, "biggestJump", `(+${pick.biggestJump.delta})`);
    if (pick.biggestFall) addAward(pick.biggestFall.key, "biggestFall", `(-${pick.biggestFall.delta})`);
    if (pick.hotShotDebut) addAward(pick.hotShotDebut.key, "hotShotDebut", "");
    if (pick.hotShotReentry) addAward(pick.hotShotReentry.key, "hotShotReentry", "");
    if (pick.longestSitter) addAward(pick.longestSitter.key, "longestSitter", "");

    return awardMap;
  }

  // -----------------------
  // History (for expand panel)
  // -----------------------
  async function getSongHistory(weeksDesc, key) {
    // newest -> oldest output
    const out = [];
    for (const w of weeksDesc) {
      const wd = await loadWeek(w);
      for (const e of wd.entries) {
        if (songKey(e.artist, e.title) === key) {
          out.push({ week: w, rank: e.rank });
          break;
        }
      }
    }
    return out; // already newest->oldest because weeksDesc is newest->oldest
  }

  // -----------------------
  // Rendering
  // -----------------------
  function movementBadge(m) {
    // Types: up/down/same/new/re
    if (!m) return el("span", { className: "move same" }, ["—"]);

    if (m.type === "up") return el("span", { className: "move up" }, [`▲ ${m.value}`]);
    if (m.type === "down") return el("span", { className: "move down" }, [`▼ ${m.value}`]);
    if (m.type === "re") return el("span", { className: "move re" }, ["RE"]);
    if (m.type === "new") return el("span", { className: "move new" }, ["NEW"]);
    return el("span", { className: "move same" }, ["—"]);
  }

  function statsBlock(lastWeek, peak, weeks) {
    const wrap = el("div", { className: "stats3" });

    // LW display: dash for NEW/RE
    const lwVal = lastWeek == null ? "—" : String(lastWeek);

    wrap.appendChild(el("span", {}, ["LW ", el("b", {}, [lwVal])]));
    wrap.appendChild(el("span", {}, ["Peak ", el("b", {}, [String(peak)])]));
    wrap.appendChild(el("span", {}, ["Weeks ", el("b", {}, [String(weeks)])]));

    return wrap;
  }

  function awardLinesFor(entry, awardMap) {
    const key = songKey(entry.artist, entry.title);
    const awards = awardMap.get(key);
    if (!awards || awards.length === 0) return null;

    const box = el("div", { className: "awardBox" });
    for (const a of awards) {
      const st = AWARD_STYLES[a.type];
      const text = `${st.label}${a.extraText ? " " + a.extraText : ""}`;
      box.appendChild(
        el("div", {
          className: "awardLine",
          style: `margin-top:6px; font-weight:800; font-size:12px; letter-spacing:.02em; color:${st.color};`,
        }, [text])
      );
    }
    return box;
  }

  function rowHTML({ entry, movement, stats, awards, weeksDesc }) {
    const key = songKey(entry.artist, entry.title);

    const li = el("li", { className: "row", dataset: { key } });

    // Top (collapsed)
    const rankBox = el("div", { className: "rankbox" }, [
      el("div", { className: "rank" }, [String(entry.rank)]),
      movementBadge(movement),
    ]);

    const img = el("img", {
      className: "cover",
      alt: `${entry.title} cover`,
      loading: "lazy",
      decoding: "async",
    });
    attachCoverFallback(img, entry.cover);

    const titleLine = el("div", { className: "titleline" }, [entry.title]);

    const artistLink = el("a", {
      href: `artist.html?artist=${encodeURIComponent(entry.artist)}`,
      title: `Open artist page for ${entry.artist}`,
      onclick: (ev) => ev.stopPropagation(),
    }, [entry.artist]);

    const artistLine = el("div", { className: "artist" }, [artistLink]);

    const awardsNode = awardLinesFor(entry, awards);

    const songText = el("div", { style: "min-width:0;" }, awardsNode
      ? [titleLine, artistLine, awardsNode]
      : [titleLine, artistLine]
    );

    const songRow = el("div", { className: "songRow" }, [img, songText]);

    const lwForDisplay = (movement.type === "new" || movement.type === "re") ? null : movement.lastWeek;
    const rightStats = statsBlock(lwForDisplay, stats.peakRank, stats.weeks);

    const top = el("div", {
      className: "rowTop",
      tabIndex: 0,
      role: "button",
      ariaExpanded: "false",
    }, [rankBox, songRow, rightStats]);

    // Expand panel
    const expand = el("div", { className: "expand" }, [
      el("div", { className: "expandHead" }, [
        el("div", { className: "expandTitle" }, [entry.title]),
        el("div", { className: "artist" }, [artistLink.cloneNode(true)]),
        el("div", { className: "stats3", style: "justify-content:flex-start; text-align:left; margin-top:10px;" }, [
          el("span", {}, ["LW ", el("b", {}, [lwForDisplay == null ? "—" : String(lwForDisplay)])]),
          el("span", {}, ["Peak ", el("b", {}, [String(stats.peakRank)])]),
          el("span", {}, ["Weeks ", el("b", {}, [String(stats.weeks)])]),
        ]),
        el("div", { className: "expandLinks" }, [
          el("a", {
            href: `artist.html?artist=${encodeURIComponent(entry.artist)}`,
            onclick: (ev) => ev.stopPropagation(),
          }, ["Open artist page"]),
          el("a", {
            href: `?week=${encodeURIComponent(stats.debutWeek || "")}`,
            onclick: (ev) => ev.stopPropagation(),
            style: "margin-left:18px;",
          }, ["Open debut week"]),
        ]),
      ]),
      el("div", { className: "history" }, [
        el("div", { className: "meta", style: "font-weight:800; letter-spacing:.08em; text-transform:uppercase; font-size:12px;" }, ["Chart History"]),
        el("div", { className: "historyList", style: "margin-top:10px;" }, [
          el("div", { className: "meta" }, ["Loading history..."]),
        ]),
      ]),
    ]);

    // Toggle behavior
    const closeAllOthers = () => {
      const openRows = document.querySelectorAll(".row.open");
      for (const r of openRows) {
        if (r !== li) {
          r.classList.remove("open");
          const rt = $(".rowTop", r);
          if (rt) rt.setAttribute("aria-expanded", "false");
        }
      }
    };

    const toggle = async () => {
      const isOpen = li.classList.contains("open");
      if (isOpen) {
        li.classList.remove("open");
        top.setAttribute("aria-expanded", "false");
        return;
      }

      closeAllOthers();
      li.classList.add("open");
      top.setAttribute("aria-expanded", "true");

      // Fill history
      const list = $(".historyList", li);
      if (!list) return;

      // If already loaded, don't re-load
      if (list.dataset.loaded === "1") return;

      try {
        const hist = await getSongHistory(weeksDesc, key);
        list.innerHTML = "";
        if (hist.length === 0) {
          list.appendChild(el("div", { className: "meta" }, ["No history found."]));
        } else {
          // newest -> oldest
          for (const h of hist) {
            const row = el("div", { className: "historyRow" }, [
              el("a", {
                href: `?week=${encodeURIComponent(h.week)}`,
                onclick: (ev) => ev.stopPropagation(),
              }, [h.week]),
              el("div", { className: "right" }, [`Rank `, el("b", {}, [`#${h.rank}`])]),
            ]);
            list.appendChild(row);
          }
        }
        list.dataset.loaded = "1";
      } catch (e) {
        list.innerHTML = "";
        list.appendChild(el("div", { className: "meta" }, ["Failed to load history."]));
      }
    };

    top.addEventListener("click", toggle);
    top.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggle();
      }
    });

    li.appendChild(top);
    li.appendChild(expand);
    return li;
  }

  function renderWeekSelect(weeksDesc, selectedWeek) {
    const sel = $("#weekSelect");
    const lbl = $("#weekLabel");

    if (!sel) return;

    sel.innerHTML = "";
    for (const w of weeksDesc) {
      const opt = el("option", { value: w }, [w]);
      if (w === selectedWeek) opt.selected = true;
      sel.appendChild(opt);
    }

    setText(lbl, selectedWeek ? `Week of ${selectedWeek}` : "Week of —");

    sel.onchange = () => {
      const w = sel.value;
      setParam("week", w, { replace: false });
      // Hard reload is simplest & keeps everything consistent.
      // If you prefer, you can call main() again instead.
      location.reload();
    };
  }

  function renderChart({ weeksDesc, selectedWeek, targetEntries, prevRanks, statsMap, awards }) {
    const chart = $("#chart");
    if (!chart) return;

    chart.innerHTML = "";

    for (const entry of targetEntries) {
      const key = songKey(entry.artist, entry.title);
      const stats = statsMap.get(key) || { debutWeek: selectedWeek, peakRank: entry.rank, peakWeek: selectedWeek, weeks: 1 };
      const movement = computeMovementForEntry(entry, prevRanks, statsMap, selectedWeek);

      chart.appendChild(
        rowHTML({
          entry,
          movement,
          stats,
          awards,
          weeksDesc,
        })
      );
    }
  }

  // -----------------------
  // Artist search (from loaded weeks)
  // -----------------------
  async function buildArtistIndex(weeksDesc) {
    // Map normalizedArtist -> { name, songs:Set(songKey), entries:number }
    const map = new Map();

    // Load weeks (cached) to build index
    for (const w of weeksDesc) {
      const wd = await loadWeek(w);
      for (const e of wd.entries) {
        const artist = cleanArtist(e.artist);
        const norm = artist.toLowerCase();

        if (!map.has(norm)) {
          map.set(norm, { name: artist, songs: new Set(), entries: 0 });
        }
        const rec = map.get(norm);
        rec.entries += 1;
        rec.songs.add(songKey(artist, e.title));
      }
    }

    // Convert to array
    const arr = [];
    for (const rec of map.values()) {
      arr.push({
        name: rec.name,
        songsCount: rec.songs.size,
        entriesCount: rec.entries,
      });
    }

    // Sort default by entries desc
    arr.sort((a, b) => b.entriesCount - a.entriesCount || a.name.localeCompare(b.name));
    return arr;
  }

  function setupArtistSearch(artistIndex) {
    const input = $("#artistSearch");
    const results = $("#searchResults");
    if (!input || !results) return;

    const hide = () => results.classList.add("hidden");
    const show = () => results.classList.remove("hidden");

    const renderResults = (items) => {
      results.innerHTML = "";
      if (items.length === 0) {
        results.appendChild(el("div", { className: "searchItem" }, [
          el("div", { className: "name" }, ["No matches"]),
        ]));
        show();
        return;
      }

      for (const it of items) {
        const row = el("div", { className: "searchItem" }, [
          el("div", { className: "name" }, [it.name]),
          el("div", { className: "meta" }, [`${it.songsCount} song(s) • ${it.entriesCount} chart entry(s)`]),
        ]);

        row.addEventListener("click", () => {
          location.href = `artist.html?artist=${encodeURIComponent(it.name)}`;
        });

        results.appendChild(row);
      }
      show();
    };

    let lastQ = "";
    input.addEventListener("input", () => {
      const q = normalizeSpace(input.value).toLowerCase();
      lastQ = q;

      if (!q) {
        results.innerHTML = "";
        hide();
        return;
      }

      const matches = artistIndex
        .filter((a) => a.name.toLowerCase().includes(q))
        .slice(0, 12);

      // If the index is big, you can speed this up later by precomputing tokens.
      if (q === lastQ) renderResults(matches);
    });

    input.addEventListener("focus", () => {
      if (normalizeSpace(input.value)) show();
    });

    document.addEventListener("click", (ev) => {
      if (!results.contains(ev.target) && ev.target !== input) hide();
    });
  }

  // -----------------------
  // Main
  // -----------------------
  async function main() {
    // Title
    const titleEl = $("#chartTitle");
    if (titleEl) titleEl.textContent = "Nabnation Top 100";
    document.title = "Nabnation Top 100";

    // Load manifest + latest
    let manifest = null;
    let latest = null;

    try {
      manifest = await fetchFirstWorking(MANIFEST_URLS);
    } catch (_) {
      manifest = { weeks: [] };
    }

    try {
      latest = await fetchFirstWorking(LATEST_URLS);
    } catch (_) {
      latest = null;
    }

    // Determine week list
    let weeks = Array.isArray(manifest.weeks) ? manifest.weeks.slice() : [];
    weeks = weeks
      .map((w) => String(w))
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a)); // newest -> oldest

    // Determine selected week
    const urlWeek = getParam("week");
    let selectedWeek = urlWeek && urlWeek.trim() ? urlWeek.trim() : null;

    if (!selectedWeek && latest && latest.week) selectedWeek = String(latest.week);
    if (!selectedWeek && weeks.length) selectedWeek = weeks[0];

    // If selectedWeek not in manifest, still try to load it; but keep dropdown usable.
    if (selectedWeek && !weeks.includes(selectedWeek)) {
      weeks.unshift(selectedWeek);
      weeks = weeks
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => b.localeCompare(a));
    }

    renderWeekSelect(weeks, selectedWeek);

    // Load stats + prev ranks
    const { statsMap, prevRanks, targetEntries } = await buildStatsAsOf(weeks, selectedWeek);

    // Compute awards
    const awards = computeAwards(targetEntries, prevRanks, statsMap, selectedWeek);

    // Render chart
    renderChart({
      weeksDesc: weeks,
      selectedWeek,
      targetEntries,
      prevRanks,
      statsMap,
      awards,
    });

    // Build artist index (async) so search works
    // (This uses cached week fetches, so it’s usually fast after first load.)
    try {
      const artistIndex = await buildArtistIndex(weeks);
      setupArtistSearch(artistIndex);
    } catch (_) {
      // If it fails, search just won't work—page still loads.
    }
  }

  main().catch((err) => {
    console.error("chart.js fatal:", err);
    // Fail-soft: show something in the chart area if possible
    const chart = document.querySelector("#chart");
    if (chart) {
      chart.innerHTML = `<li class="row"><div class="rowTop"><div class="meta">Failed to load chart data. Check console.</div></div></li>`;
    }
  });
})();
