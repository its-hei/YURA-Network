const state = {
  commands: [],
  filter: "Everyone",
  query: "",
  openGroups: new Set(),
  leaderboardQuery: "",
  leaderboardEntries: [],
  leaderboardUpdatedAt: null,
  leaderboardHidePrivileged: false,
  initialGroupOpened: false
};

const body = document.getElementById("commandsBody");
const empty = document.getElementById("emptyState");
const searchInput = document.getElementById("searchInput");
const tabs = [...document.querySelectorAll(".tab")];
const initiallyActiveTab = document.querySelector(".tab.active");
state.filter = initiallyActiveTab?.dataset.filter || "Everyone";

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderCounts() {
  document.getElementById("count-all").textContent = state.commands.length;
  document.getElementById("count-everyone").textContent =
    state.commands.filter(c => c.permission === "Everyone").length;
  document.getElementById("count-moderator").textContent =
    state.commands.filter(c => c.permission === "Moderator").length;
}

function render() {
  const query = state.query.trim().toLowerCase();

  const filtered = state.commands.filter(command => {
    const permissionMatches =
      state.filter === "all" || command.permission === state.filter;

    const searchSpace = [
      command.command,
      ...(command.aliases || []),
      command.usage,
      command.description,
      command.permission,
      command.category || ""
    ].join(" ").toLowerCase();

    return permissionMatches && (!query || searchSpace.includes(query));
  });

  const groups = [];
  filtered.forEach(command => {
    const category = command.category || "INNE";
    let group = groups.find(item => item.category === category);
    if (!group) {
      group = { category, commands: [] };
      groups.push(group);
    }
    group.commands.push(command);
  });

  const firstCategory = groups[0]?.category || null;

  if (!state.initialGroupOpened && query.length === 0 && firstCategory) {
    state.openGroups.clear();
    state.openGroups.add(firstCategory);
    state.initialGroupOpened = true;
  }

  body.innerHTML = groups.map(group => {
    // Po starcie i po zmianie filtra pierwsza grupa otwiera się automatycznie.
    // Podczas wyszukiwania rozwijamy trafienia, żeby wynik nie był schowany.
    const isOpen =
      query.length > 0 ||
      state.openGroups.has(group.category);

    const rows = group.commands.map(command => {
      const aliases = command.aliases || [];
      const badgeClass = command.permission.toLowerCase();

      return `
        <tr class="command-row" ${isOpen ? "" : "hidden"}>
          <td>
            <div class="command-main">
              <button
                class="command copy-command"
                type="button"
                data-copy="${esc(command.command)}"
                title="Kliknij, aby skopiować"
              >${esc(command.command)}</button>
              ${aliases.length ? `<span class="alias-count">+${aliases.length}</span>` : ""}
            </div>
            ${aliases.length ? `<div class="aliases">${aliases.map(alias => `
              <button
                class="alias-copy copy-command"
                type="button"
                data-copy="${esc(alias)}"
                title="Kliknij, aby skopiować"
              >${esc(alias)}</button>
            `).join('<span class="alias-separator"> · </span>')}</div>` : ""}
          </td>
          <td>
            <span class="badge ${badgeClass}">${esc(command.permission)}</span>
          </td>
          <td>
            <div class="usage">${esc(command.usage)}</div>
            <div class="description">${esc(command.description)}</div>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <tr class="group-row ${isOpen ? "open" : ""}">
        <td colspan="3">
          <button
            class="group-toggle"
            type="button"
            data-category="${esc(group.category)}"
            aria-expanded="${isOpen ? "true" : "false"}"
          >
            <span class="group-heading">
              <span class="group-chevron" aria-hidden="true">›</span>
              <span class="group-label">${esc(group.category)}</span>
              <span class="group-count">${group.commands.length}</span>
            </span>
            <span class="group-state">${isOpen ? "ZWIŃ" : "ROZWIŃ"}</span>
          </button>
        </td>
      </tr>
      ${rows}
    `;
  }).join("");

  empty.hidden = filtered.length !== 0;
}

const copyToast = document.getElementById("copyToast");
let copyToastTimer = null;

async function copyText(value) {
  const text = String(value || "").trim();
  if (!text) return;

  let copied = false;

  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (_) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      copied = document.execCommand("copy");
    } catch (_) {
      copied = false;
    }

    textarea.remove();
  }

  if (!copyToast) return;

  copyToast.textContent = copied
    ? `SKOPIOWANO // ${text}`
    : "NIE UDAŁO SIĘ SKOPIOWAĆ";

  copyToast.hidden = false;
  copyToast.classList.toggle("is-error", !copied);

  if (copyToastTimer) {
    window.clearTimeout(copyToastTimer);
  }

  copyToastTimer = window.setTimeout(() => {
    copyToast.hidden = true;
    copyToast.classList.remove("is-error");
  }, 1600);
}

body.addEventListener("click", event => {
  const copyButton = event.target.closest(".copy-command");

  if (copyButton) {
    copyText(copyButton.dataset.copy);
    return;
  }

  const toggle = event.target.closest(".group-toggle");
  if (!toggle) return;

  const category = toggle.dataset.category;
  if (!category) return;

  if (state.openGroups.has(category)) {
    state.openGroups.delete(category);
  } else {
    state.openGroups.add(category);
  }

  render();
});

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(item => item.classList.remove("active"));
    tab.classList.add("active");
    state.filter = tab.dataset.filter;
    // Każdy filtr startuje z automatycznie rozwiniętą pierwszą grupą.
    state.openGroups.clear();
    state.initialGroupOpened = false;
    render();
  });
});

searchInput.addEventListener("input", event => {
  state.query = event.target.value;
  render();
});

fetch("./commands.json?v=24", { cache: "no-store" })
  .then(response => {
    if (!response.ok) {
      throw new Error("Nie udało się pobrać commands.json");
    }
    return response.json();
  })
  .then(data => {
    state.commands = Array.isArray(data) ? data : [];
    renderCounts();
    render();
  })
  .catch(error => {
    body.innerHTML = `
      <tr class="loading-row">
        <td colspan="3">Błąd ładowania danych: ${esc(error.message)}</td>
      </tr>
    `;
  });


// ==============================
// VIEW SWITCHING + LEADERBOARD
// ==============================
const viewButtons = [...document.querySelectorAll(".side-item[data-view]")];
const commandsView = document.getElementById("commandsView");
const leaderboardView = document.getElementById("leaderboardView");
const leaderboardStatus = document.getElementById("leaderboardStatus");
const leaderboardUpdated = document.getElementById("leaderboardUpdated");
const leaderboardSearchInput = document.getElementById("leaderboardSearchInput");
const leaderboardEligibilityToggle = document.getElementById("leaderboardEligibilityToggle");
const leaderboardEligibilityLabel = document.getElementById("leaderboardEligibilityLabel");
const leaderboardPodium = document.getElementById("leaderboardPodium");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardRows = document.getElementById("leaderboardRows");
const leaderboardEmpty = document.getElementById("leaderboardEmpty");
const aboutView = document.getElementById("aboutView");
const scheduleView = document.getElementById("scheduleView");
const changelogView = document.getElementById("changelogView");
const changelogList = document.getElementById("changelogList");

let activeView = "commands";
let leaderboardTimer = null;
let leaderboardBusy = false;
function formatPoints(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("pl-PL").format(number);
}

function formatSync(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function rankMark(rank) {
  if (rank === 1) return "Ⅰ";
  if (rank === 2) return "Ⅱ";
  if (rank === 3) return "Ⅲ";
  return String(rank).padStart(2, "0");
}

function movementMarkup(entry) {
  if (entry.isNew === true) {
    return '<span class="rank-movement movement-new">NEW</span>';
  }

  const delta = Number(entry.rankDelta) || 0;

  if (delta > 0) {
    return `<span class="rank-movement movement-up">↑${delta}</span>`;
  }

  if (delta < 0) {
    return `<span class="rank-movement movement-down">↓${Math.abs(delta)}</span>`;
  }

  return '<span class="rank-movement movement-flat">—</span>';
}

function renderLeaderboard(data) {
  const sourceEntries = Array.isArray(data?.entries)
    ? data.entries
        .filter(item => item && item.name && Number(item.points) >= 0)
        .sort((a, b) => Number(b.points) - Number(a.points))
        .map(item => ({
          ...item,
          points: Number(item.points) || 0,
          isVip: item.isVip === true,
          isModerator: item.isModerator === true,
          isMonthlyVipExcluded: item.isMonthlyVipExcluded === true,
          rankDelta: Number(item.rankDelta) || 0,
          isNew: item.isNew === true
        }))
    : [];

  state.leaderboardEntries = sourceEntries;
  if (data?.updatedAt) state.leaderboardUpdatedAt = data.updatedAt;
  leaderboardUpdated.textContent = formatSync(state.leaderboardUpdatedAt);

  const eligibleEntries = state.leaderboardHidePrivileged
    ? sourceEntries.filter(entry => !entry.isMonthlyVipExcluded)
    : sourceEntries;

  const entries = eligibleEntries
    .slice(0, 10)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));

  const query = state.leaderboardQuery.trim().toLowerCase();
  const matches = query
    ? entries.filter(entry => String(entry.name).toLowerCase().includes(query))
    : [];
  const matchNames = new Set(matches.map(entry => entry.name));

  if (leaderboardEligibilityToggle) {
    leaderboardEligibilityToggle.classList.toggle(
      "candidate-cta",
      !state.leaderboardHidePrivileged
    );
    leaderboardEligibilityToggle.classList.toggle(
      "show-all",
      state.leaderboardHidePrivileged
    );
    leaderboardEligibilityToggle.setAttribute(
      "aria-pressed",
      state.leaderboardHidePrivileged ? "true" : "false"
    );

    if (leaderboardEligibilityLabel) {
      leaderboardEligibilityLabel.textContent =
        state.leaderboardHidePrivileged
          ? "WSZYSCY"
          : "KANDYDACI VIP";
    }

    leaderboardEligibilityToggle.title =
      state.leaderboardHidePrivileged
        ? "Wróć do pełnego rankingu"
        : "Pokaż ranking kandydatów do miesięcznego VIP-a";
  }

  leaderboardPodium?.classList.toggle(
    "candidate-mode",
    state.leaderboardHidePrivileged && eligibleEntries.length > 0
  );

  if (!entries.length) {
    leaderboardStatus.textContent = "LIVE DATA";
    leaderboardStatus.classList.add("is-live");
    leaderboardPodium.hidden = true;
    leaderboardList.hidden = true;
    leaderboardEmpty.hidden = false;
    return;
  }

  leaderboardStatus.textContent = "LIVE DATA";
  leaderboardStatus.classList.add("is-live");
  leaderboardEmpty.hidden = true;

  const top = entries.slice(0, 3);
  leaderboardPodium.innerHTML = top.map(entry => {
    const rank = entry.rank;
    const isMatch = query && matchNames.has(entry.name);
    return `
      <article class="podium-card rank-${rank} ${isMatch ? "is-match" : ""}" data-rank="${rank}" data-name="${esc(entry.name)}">
        <div class="podium-rank">${rankMark(rank)}</div>
        <div class="podium-kicker">
          <span>RANK ${String(rank).padStart(2, "0")}</span>
          ${movementMarkup(entry)}
        </div>
        <strong class="podium-name">${esc(entry.name)}</strong>
        <div class="podium-points">${formatPoints(entry.points)}</div>
        <div class="podium-unit">Y.U.R.A. POINTS</div>
      </article>
    `;
  }).join("");
  leaderboardPodium.hidden = false;

  const remaining = entries.slice(3);
  if (remaining.length) {
    leaderboardRows.innerHTML = remaining.map(entry => {
      const isMatch = query && matchNames.has(entry.name);
      return `
        <div class="leaderboard-row ${isMatch ? "is-match" : ""}" data-rank="${entry.rank}" data-name="${esc(entry.name)}">
          <span class="leaderboard-rank">${rankMark(entry.rank)}</span>
          <strong class="leaderboard-name">
            <span>${esc(entry.name)}</span>
            ${movementMarkup(entry)}
          </strong>
          <span class="leaderboard-points">${formatPoints(entry.points)}</span>
        </div>
      `;
    }).join("");
    leaderboardList.hidden = false;
  } else {
    leaderboardRows.innerHTML = "";
    leaderboardList.hidden = true;
  }

  if (query) {
    if (matches.length) {
      const firstMatch = matches[0];
      leaderboardStatus.textContent = `ZNALEZIONO ${matches.length}`;
      leaderboardStatus.classList.add("is-live");
      window.requestAnimationFrame(() => {
        const target = document.querySelector(`[data-rank="${firstMatch.rank}"]`);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    } else {
      leaderboardStatus.textContent = "BRAK WYNIKÓW";
      leaderboardStatus.classList.remove("is-live");
    }
  }
}

function applyClientRankMovement(data) {
  const previousRanks = new Map(
    state.leaderboardEntries.map((entry, index) => [
      String(entry.login || entry.name || "").toLowerCase(),
      index + 1
    ])
  );
  const hadPrevious = state.leaderboardEntries.length > 0;
  const entries = Array.isArray(data?.entries) ? [...data.entries] : [];
  entries.sort((a, b) => Number(b.points || 0) - Number(a.points || 0));

  return {
    ...data,
    entries: entries.map((entry, index) => {
      const key = String(entry.login || entry.name || "").toLowerCase();
      const previousRank = previousRanks.get(key);
      const currentRank = index + 1;
      return {
        ...entry,
        rankDelta: previousRank ? previousRank - currentRank : 0,
        isNew: hadPrevious && !previousRank
      };
    })
  };
}





// YURA_CLOUD_FALLBACK_V57
const YURA_CLOUD_BASE = "https://yura-cloud.heiyeshi.workers.dev";
const LEADERBOARD_POLL_MS = 5 * 60 * 1000;
const LEADERBOARD_LAST_SYNC_KEY = "yura.leaderboard.lastSync.v57";
let leaderboardRevision = "";
let leaderboardMetadataLoaded = false;
let leaderboardMetadataByName = new Map();
let leaderboardFallbackData = null;

function formatLastSyncLabel(data) {
  const raw = String(data?.updatedAt || data?.generated_at_utc || "").trim();
  if (!raw) return "LAST SYNC";
  const stamp = new Date(raw);
  if (Number.isNaN(stamp.getTime())) return "LAST SYNC";
  return `LAST SYNC â€˘ ${stamp.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`;
}

async function loadLeaderboardMetadata() {
  if (leaderboardMetadataLoaded) return;

  // Browser cache is a third safety net. The GitHub live-data snapshot remains the
  // cross-device fallback used when Cloud/D1 is unavailable.
  if (!leaderboardFallbackData) {
    try {
      const cached = window.localStorage.getItem(LEADERBOARD_LAST_SYNC_KEY);
      if (cached) leaderboardFallbackData = JSON.parse(cached);
    } catch {}
  }

  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/its-hei/YURA-Network/live-data/leaderboard.json?t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const data = await response.json();
    leaderboardFallbackData = data;
    try { window.localStorage.setItem(LEADERBOARD_LAST_SYNC_KEY, JSON.stringify(data)); } catch {}
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const metadata = new Map();
    for (const item of entries) {
      const value = {
        isVip: item?.isVip === true,
        isModerator: item?.isModerator === true,
        isMonthlyVipExcluded: item?.isMonthlyVipExcluded === true
      };
      const nameKey = String(item?.name || "").trim().toLowerCase();
      const loginKey = String(item?.login || "").trim().toLowerCase();
      if (nameKey) metadata.set(nameKey, value);
      if (loginKey) metadata.set(loginKey, value);
    }
    leaderboardMetadataByName = metadata;
    leaderboardMetadataLoaded = true;
  } catch (error) {
    console.warn("Leaderboard metadata fallback unavailable:", error);
  }
}

function mergeLeaderboardMetadata(data) {
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  return {
    ...data,
    entries: entries.map(item => {
      const nameKey = String(item?.name || "").trim().toLowerCase();
      const loginKey = String(item?.login || "").trim().toLowerCase();
      const meta = leaderboardMetadataByName.get(loginKey) || leaderboardMetadataByName.get(nameKey) || {};
      return {
        ...item,
        isVip: item?.isVip === true || meta.isVip === true,
        isModerator: item?.isModerator === true || meta.isModerator === true,
        isMonthlyVipExcluded: item?.isMonthlyVipExcluded === true || meta.isMonthlyVipExcluded === true
      };
    })
  };
}

async function getLeaderboardRevision() {
  const response = await fetch(`${YURA_CLOUD_BASE}/api/leaderboard-revision`, { cache: "no-store" });
  if (!response.ok) throw new Error(`revision HTTP ${response.status}`);
  const data = await response.json();
  return String(data?.revision || "");
}
async function loadLeaderboard(force = false) {
  if (leaderboardBusy || document.hidden || activeView !== "leaderboard") return;
  leaderboardBusy = true;

  try {
    await loadLeaderboardMetadata();
    const revision = await getLeaderboardRevision();
    if (!force && leaderboardRevision && revision === leaderboardRevision) {
      leaderboardStatus.textContent = "LIVE DATA";
      leaderboardStatus.classList.add("is-live");
      return;
    }

    const response = await fetch(`${YURA_CLOUD_BASE}/api/leaderboard`, { cache: "no-store" });
    if (!response.ok) throw new Error(`leaderboard HTTP ${response.status}`);
    const cloudData = await response.json();
    const data = mergeLeaderboardMetadata(cloudData);
    if ((!Array.isArray(data?.entries) || data.entries.length === 0) &&
        leaderboardFallbackData && Array.isArray(leaderboardFallbackData.entries) && leaderboardFallbackData.entries.length > 0) {
      leaderboardRevision = "";
      renderLeaderboard(leaderboardFallbackData);
      leaderboardStatus.textContent = formatLastSyncLabel(leaderboardFallbackData);
      leaderboardStatus.classList.remove("is-live");
    } else {
      leaderboardRevision = String(data?.revision || revision || "");
      renderLeaderboard(data);
    }
  } catch (error) {
    // Cloud can be temporarily unavailable or quota-limited. Refresh the GitHub snapshot
    // here so SYNC NOW becomes visible without requiring a full page reload.
    leaderboardMetadataLoaded = false;
    await loadLeaderboardMetadata();
    if (leaderboardFallbackData && Array.isArray(leaderboardFallbackData.entries)) {
      leaderboardRevision = "";
      renderLeaderboard(leaderboardFallbackData);
      leaderboardStatus.textContent = formatLastSyncLabel(leaderboardFallbackData);
      leaderboardStatus.classList.remove("is-live");
    } else {
      leaderboardStatus.textContent = "SYNC ERROR";
      leaderboardStatus.classList.remove("is-live");
    }
    console.error("Leaderboard cloud sync failed:", error);
  } finally {
    leaderboardBusy = false;
  }
}

function ensureLeaderboardRefreshButton() {
  if (!leaderboardStatus || document.getElementById("leaderboard-cloud-refresh")) return;
  const host = leaderboardStatus.parentElement;
  if (!host) return;

  const button = document.createElement("button");
  button.id = "leaderboard-cloud-refresh";
  button.type = "button";
  button.textContent = "ODĹšWIEĹ»";
  button.title = "Pobierz aktualny ranking z YURA Cloud teraz";
  button.style.marginLeft = "10px";
  button.style.padding = "5px 9px";
  button.style.fontSize = "10px";
  button.style.cursor = "pointer";
  button.addEventListener("click", () => loadLeaderboard(true));
  host.appendChild(button);
}

function startLeaderboardPolling() {
  stopLeaderboardPolling();
  loadLeaderboard(false);
  leaderboardTimer = window.setInterval(() => loadLeaderboard(false), LEADERBOARD_POLL_MS);
}

function stopLeaderboardPolling() {
  if (leaderboardTimer) {
    window.clearInterval(leaderboardTimer);
    leaderboardTimer = null;
  }
}

// YURA_CLOUD_VISIBILITY_RESUME
// Hidden tabs do not poll Cloud. Returning to the ranking performs one tiny revision check.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && activeView === "leaderboard") {
    loadLeaderboard(false);
  }
});

document.addEventListener("visibilitychange", () => {
  if (activeView !== "leaderboard") return;
  if (document.hidden) {
    stopLeaderboardPolling();
  } else {
    startLeaderboardPolling();
  }
});
function switchView(view) {
  activeView = view;

  viewButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  commandsView.hidden = view !== "commands";
  leaderboardView.hidden = view !== "leaderboard";
  aboutView.hidden = view !== "about";
  scheduleView.hidden = view !== "schedule";
  changelogView.hidden = view !== "changelog";

  if (view === "leaderboard") {
    startLeaderboardPolling();
  } else {
    stopLeaderboardPolling();
  }
}

viewButtons.forEach(button => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

leaderboardEligibilityToggle?.addEventListener("click", () => {
  state.leaderboardHidePrivileged = !state.leaderboardHidePrivileged;

  renderLeaderboard({
    updatedAt: state.leaderboardUpdatedAt,
    entries: state.leaderboardEntries
  });
});

leaderboardSearchInput?.addEventListener("input", event => {
  state.leaderboardQuery = event.target.value;
  renderLeaderboard({
    updatedAt: state.leaderboardUpdatedAt,
    entries: state.leaderboardEntries
  });
});


// ==============================
// CHANGELOG
// ==============================
function renderChangelog(items) {
  if (!changelogList) return;

  if (!Array.isArray(items) || !items.length) {
    changelogList.innerHTML = `
      <div class="changelog-loading">Brak wpisów w dzienniku zmian.</div>
    `;
    return;
  }

  changelogList.innerHTML = items.map((entry, index) => `
    <article class="changelog-card ${index === 0 ? "latest" : ""}">
      <div class="changelog-rail">
        <span class="changelog-node"></span>
      </div>
      <div class="changelog-content">
        <div class="changelog-header">
          <div>
            <span class="changelog-version">${esc(entry.version || "")}</span>
            ${index === 0 ? '<span class="changelog-latest">LATEST</span>' : ""}
          </div>
          <time>${esc(entry.date || "")}</time>
        </div>
        <h2>${esc(entry.title || "")}</h2>
        <ul>
          ${(entry.items || []).map(item => `<li>${esc(item)}</li>`).join("")}
        </ul>
      </div>
    </article>
  `).join("");
}

fetch("./changelog.json?v=24", { cache: "no-store" })
  .then(response => {
    if (!response.ok) {
      throw new Error("Nie udało się pobrać changelog.json");
    }
    return response.json();
  })
  .then(renderChangelog)
  .catch(error => {
    if (changelogList) {
      changelogList.innerHTML = `
        <div class="changelog-loading">Błąd ładowania changelogu: ${esc(error.message)}</div>
      `;
    }
  });

// YURA_LIVE_SCHEDULE_V62
const YURA_SCHEDULE_TIME_ZONE = "Europe/Warsaw";
const YURA_SCHEDULE_ANCHOR_UTC = Date.UTC(2026, 8, 28); // Monday 2026-09-28 = RANO
const YURA_SCHEDULE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const YURA_SCHEDULE_SHIFTS = ["RANO", "NOCKA", "POPO"];
const YURA_SCHEDULE_DAY_NAMES = ["PON", "WT", "ŚR", "CZW", "PT", "SOB", "ND"];
let yuraScheduleWeekOffset = 0;
let yuraScheduleTimer = null;

function yuraSchedulePositiveMod(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function yuraScheduleDateKeyFromUtcMs(utcMs) {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function yuraScheduleWarsawNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: YURA_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    dateKey: `${map.year}-${map.month}-${map.day}`
  };
}

function yuraScheduleMondayUtc(year, month, day) {
  const utc = Date.UTC(year, month - 1, day);
  const weekday = new Date(utc).getUTCDay(); // Sun=0 ... Sat=6
  const mondayDistance = (weekday + 6) % 7;
  return utc - mondayDistance * 24 * 60 * 60 * 1000;
}

function yuraScheduleShiftForMonday(mondayUtc) {
  const weekIndex = Math.round((mondayUtc - YURA_SCHEDULE_ANCHOR_UTC) / YURA_SCHEDULE_WEEK_MS);
  return YURA_SCHEDULE_SHIFTS[yuraSchedulePositiveMod(weekIndex, YURA_SCHEDULE_SHIFTS.length)];
}

function yuraScheduleWindowForDay(dayIndex, shift) {
  if (dayIndex === 3) {
    return { start: null, end: null, label: "OFF", note: "CZWARTEK • BEZ STREAMA", isOff: true };
  }
  if (dayIndex === 5) {
    return { start: 16 * 60, end: 22 * 60, label: "16:00–22:00", note: "SOBOTA • LONG SESSION", isWeekend: true };
  }
  if (dayIndex === 6) {
    return { start: 16 * 60, end: 20 * 60, label: "16:00–20:00", note: "NIEDZIELA • STREAM", isWeekend: true };
  }
  if (shift === "POPO") {
    return { start: 9 * 60, end: 12 * 60, label: "09:00–12:00", note: "POPO • STREAM" };
  }
  return { start: 17 * 60, end: 20 * 60, label: "17:00–20:00", note: `${shift} • STREAM` };
}

function yuraScheduleFormatShortDate(utcMs) {
  const d = new Date(utcMs);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yuraScheduleFormatLongDate(utcMs) {
  const d = new Date(utcMs);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

function yuraScheduleNextStream(nowParts) {
  const todayUtc = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
  const currentMinutes = nowParts.hour * 60 + nowParts.minute;

  for (let offset = 0; offset < 21; offset++) {
    const dayUtc = todayUtc + offset * 24 * 60 * 60 * 1000;
    const day = new Date(dayUtc);
    const jsDay = day.getUTCDay();
    const dayIndex = (jsDay + 6) % 7;
    const mondayUtc = dayUtc - dayIndex * 24 * 60 * 60 * 1000;
    const shift = yuraScheduleShiftForMonday(mondayUtc);
    const window = yuraScheduleWindowForDay(dayIndex, shift);
    if (window.isOff) continue;
    if (offset === 0 && currentMinutes >= window.end) continue;
    return { dayUtc, dayIndex, shift, window, isToday: offset === 0 };
  }
  return null;
}

function yuraScheduleEnsureStyles() {
  if (document.getElementById("yura-live-schedule-styles")) return;
  const style = document.createElement("style");
  style.id = "yura-live-schedule-styles";
  style.textContent = `
    .schedule-live-toolbar{margin-top:14px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--panel);display:flex;align-items:center;justify-content:space-between;gap:10px;box-shadow:var(--shadow)}
    .schedule-live-title{display:grid;gap:3px}.schedule-live-title span{color:#687381;font-size:8px;font-weight:900;letter-spacing:.13em}.schedule-live-title strong{color:#e7edf4;font-family:Consolas,Monaco,monospace;font-size:12px}
    .schedule-live-actions{display:flex;gap:6px}.schedule-live-actions button{min-width:34px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#0d1116;color:#9ba6b4;cursor:pointer;font:inherit;font-size:10px;font-weight:800}.schedule-live-actions button:hover{border-color:rgba(242,140,24,.35);color:#fff}.schedule-live-actions button[data-schedule-today]{min-width:auto;color:var(--accent)}
    .day-card.today{border-color:rgba(73,215,154,.55);box-shadow:0 0 0 1px rgba(73,215,154,.14),var(--shadow);background:linear-gradient(180deg,rgba(73,215,154,.07),transparent 75%),var(--panel)}
    .day-card.off{opacity:.58;background:#0c0f13;border-style:dashed}.day-card.off strong{color:#727c88}.day-card.is-live-now{border-color:rgba(73,215,154,.72);background:linear-gradient(180deg,rgba(73,215,154,.12),transparent 80%),var(--panel)}
    .day-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.day-date{color:#626d7a;font-family:Consolas,Monaco,monospace;font-size:8px}.day-card.today .day-date{color:var(--green)}
    .schedule-live-now{color:var(--green)!important}.schedule-live-next{color:var(--accent)!important}
    .schedule-window-card.current-shift{border-color:rgba(183,161,255,.26);background:radial-gradient(circle at 86% 12%,rgba(183,161,255,.08),transparent 36%),var(--panel)}
    @media(max-width:720px){.schedule-live-toolbar{align-items:flex-start;flex-direction:column}.schedule-live-actions{width:100%}.schedule-live-actions button{flex:1}}
  `;
  document.head.appendChild(style);
}

function renderYuraLiveSchedule() {
  const host = document.getElementById("scheduleView");
  if (!host) return;
  yuraScheduleEnsureStyles();

  const now = yuraScheduleWarsawNowParts();
  const currentMondayUtc = yuraScheduleMondayUtc(now.year, now.month, now.day);
  const shownMondayUtc = currentMondayUtc + yuraScheduleWeekOffset * YURA_SCHEDULE_WEEK_MS;
  const shownShift = yuraScheduleShiftForMonday(shownMondayUtc);
  const nextShift = yuraScheduleShiftForMonday(shownMondayUtc + YURA_SCHEDULE_WEEK_MS);
  const followingShift = yuraScheduleShiftForMonday(shownMondayUtc + 2 * YURA_SCHEDULE_WEEK_MS);
  const nextStream = yuraScheduleNextStream(now);
  const shownWeekIsCurrent = yuraScheduleWeekOffset === 0;

  let isLiveNow = false;
  if (nextStream?.isToday && !nextStream.window.isOff) {
    const minutes = now.hour * 60 + now.minute;
    isLiveNow = minutes >= nextStream.window.start && minutes < nextStream.window.end;
  }

  const nextStreamLabel = nextStream
    ? `${nextStream.isToday ? "DZIŚ" : YURA_SCHEDULE_DAY_NAMES[nextStream.dayIndex]} ${yuraScheduleFormatShortDate(nextStream.dayUtc)} • ${nextStream.window.label}`
    : "—";

  const weekdayWindow = shownShift === "POPO" ? "09:00–12:00" : "17:00–20:00";
  const daysHtml = YURA_SCHEDULE_DAY_NAMES.map((dayName, dayIndex) => {
    const dayUtc = shownMondayUtc + dayIndex * 24 * 60 * 60 * 1000;
    const dateKey = yuraScheduleDateKeyFromUtcMs(dayUtc);
    const window = yuraScheduleWindowForDay(dayIndex, shownShift);
    const isToday = dateKey === now.dateKey;
    const minutes = now.hour * 60 + now.minute;
    const liveToday = isToday && !window.isOff && minutes >= window.start && minutes < window.end;
    const classes = ["day-card"];
    if (window.isWeekend) classes.push("weekend");
    if (window.isOff) classes.push("off");
    if (isToday) classes.push("today");
    if (liveToday) classes.push("is-live-now");
    return `
      <article class="${classes.join(" ")}">
        <div class="day-top">
          <span class="day-name">${dayName}</span>
          <span class="day-date">${yuraScheduleFormatShortDate(dayUtc)}</span>
        </div>
        <strong>${window.label}</strong>
        <span class="day-note ${liveToday ? "schedule-live-now" : ""}">${liveToday ? "LIVE WINDOW" : window.note}</span>
      </article>`;
  }).join("");

  host.innerHTML = `
    <div class="hero">
      <div>
        <div class="eyebrow">STREAM CALENDAR // AUTO</div>
        <h1>Harmonogram</h1>
        <p>Automatyczny kalendarz liczony z cyklu RANO → NOCKA → POPO. Strefa czasu: Polska.</p>
      </div>
      <div class="status-chip ${isLiveNow ? "schedule-live-now" : ""}">${isLiveNow ? "LIVE WINDOW" : `AUTO • ${yuraScheduleShiftForMonday(currentMondayUtc)}`}</div>
    </div>

    <div class="schedule-summary">
      <article class="schedule-window-card current-shift">
        <div class="schedule-window-top">
          <span class="schedule-code">${shownWeekIsCurrent ? "TEN TYDZIEŃ" : "WYBRANY TYDZIEŃ"}</span>
          <span class="schedule-state">${shownShift}</span>
        </div>
        <strong>${yuraScheduleFormatShortDate(shownMondayUtc)} — ${yuraScheduleFormatShortDate(shownMondayUtc + 6 * 24 * 60 * 60 * 1000)}</strong>
        <p>${shownShift} • PN/WT/ŚR/PT ${weekdayWindow} • CZW OFF</p>
      </article>
      <article class="schedule-window-card weekend">
        <div class="schedule-window-top">
          <span class="schedule-code">NAJBLIŻSZY STREAM</span>
          <span class="schedule-state">${isLiveNow ? "TERAZ" : "NEXT"}</span>
        </div>
        <strong class="${isLiveNow ? "schedule-live-now" : "schedule-live-next"}">${nextStreamLabel}</strong>
        <p>Sobota 16:00–22:00 • Niedziela 16:00–20:00.</p>
      </article>
    </div>

    <div class="schedule-live-toolbar">
      <div class="schedule-live-title">
        <span>KALENDARZ TYGODNIOWY //</span>
        <strong>${yuraScheduleFormatLongDate(shownMondayUtc)} — ${yuraScheduleFormatLongDate(shownMondayUtc + 6 * 24 * 60 * 60 * 1000)} • ${shownShift}</strong>
      </div>
      <div class="schedule-live-actions">
        <button type="button" data-schedule-prev title="Poprzedni tydzień">←</button>
        <button type="button" data-schedule-today>DZIŚ</button>
        <button type="button" data-schedule-next title="Następny tydzień">→</button>
      </div>
    </div>

    <div class="schedule-week">${daysHtml}</div>

    <div class="schedule-notices">
      <article class="schedule-notice work-cycle">
        <div class="notice-icon">03</div>
        <div>
          <span class="notice-label">CYKL PRACY //</span>
          <strong>${shownShift} → ${nextShift} → ${followingShift}</strong>
          <p>Tydzień 28.09.2026 jest zakotwiczony jako RANO. Dalej harmonogram przelicza się automatycznie co poniedziałek bez ręcznej aktualizacji.</p>
        </div>
      </article>
      <article class="schedule-notice discord-notice">
        <div class="notice-icon">i</div>
        <div>
          <span class="notice-label">STAŁE ZASADY //</span>
          <strong>Czwartek zawsze bez streama</strong>
          <p>Dodatkowe wolne dni, urlopy i spontaniczne zmiany nadal pojawiają się na Discordzie.</p>
          <a href="https://discord.gg/8NHhFsRed5" target="_blank" rel="noreferrer">discord.gg/8NHhFsRed5</a>
        </div>
      </article>
    </div>`;
}

function yuraScheduleStartAutoRefresh() {
  if (yuraScheduleTimer) window.clearInterval(yuraScheduleTimer);
  renderYuraLiveSchedule();
  yuraScheduleTimer = window.setInterval(() => {
    if (!document.hidden) renderYuraLiveSchedule();
  }, 60 * 1000);
}

document.addEventListener("click", event => {
  if (!event.target.closest("#scheduleView")) return;
  if (event.target.closest("[data-schedule-prev]")) {
    yuraScheduleWeekOffset -= 1;
    renderYuraLiveSchedule();
  } else if (event.target.closest("[data-schedule-next]")) {
    yuraScheduleWeekOffset += 1;
    renderYuraLiveSchedule();
  } else if (event.target.closest("[data-schedule-today]")) {
    yuraScheduleWeekOffset = 0;
    renderYuraLiveSchedule();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderYuraLiveSchedule();
});

yuraScheduleStartAutoRefresh();
