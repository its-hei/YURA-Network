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
// YURA_PUBLIC_BOT_FILTER_HELPER_V69
const PUBLIC_LEADERBOARD_BOT_LOGINS = new Set([
  "yuranetwork", "yuranetworkttv", "streamelements", "nightbot",
  "sery_bot", "serybot", "streamlabs", "moobot", "fossabot",
  "creatisbot", "botrix"
]);
function isPublicLeaderboardBot(item) {
  const login = String(item?.login || "").trim().replace(/^@/, "").toLowerCase();
  const name = String(item?.name || item?.display_name || "").trim().replace(/^@/, "").toLowerCase();
  return PUBLIC_LEADERBOARD_BOT_LOGINS.has(login) ||
    PUBLIC_LEADERBOARD_BOT_LOGINS.has(name) ||
    login.includes("botrix") || name.includes("botrix");
}
function filterPublicLeaderboardData(data) {
  const entries = Array.isArray(data?.entries) ? data.entries.filter(item => !isPublicLeaderboardBot(item)) : [];
  return { ...data, entries };
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
    const data = filterPublicLeaderboardData(mergeLeaderboardMetadata(cloudData));
    if ((!Array.isArray(data?.entries) || data.entries.length === 0) &&
        leaderboardFallbackData && Array.isArray(leaderboardFallbackData.entries) && leaderboardFallbackData.entries.length > 0) {
      leaderboardRevision = "";
      renderLeaderboard(filterPublicLeaderboardData(leaderboardFallbackData));
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
      renderLeaderboard(filterPublicLeaderboardData(leaderboardFallbackData));
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

// YURA_LIVE_SCHEDULE_V68
const YURA_SCHEDULE_TIME_ZONE = "Europe/Warsaw";
const YURA_SCHEDULE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const YURA_SCHEDULE_DAY_MS = 24 * 60 * 60 * 1000;
const YURA_SCHEDULE_DAY_NAMES = ["PON", "WT", "ŚR", "CZW", "PT", "SOB", "ND"];
const YURA_SCHEDULE_DEFAULT_CONFIG = {
  schemaVersion: 1,
  timeZone: "Europe/Warsaw",
  anchorMonday: "2026-09-28",
  anchorShift: "RANO",
  shiftCycle: ["RANO", "NOCKA", "POPO"],
  defaultCategory: "FFXIV",
  weeklyRules: {
    "0": { enabled: true, category: "FFXIV" },
    "1": { enabled: true, category: "FFXIV" },
    "2": { enabled: true, category: "FFXIV" },
    "3": { enabled: false, category: "FFXIV" },
    "4": { enabled: true, category: "FFXIV" },
    "5": { enabled: true, category: "FFXIV" },
    "6": { enabled: true, category: "FFXIV" }
  },
  categoryArts: { FFXIV: "", TIBIA: "", MMO: "", RPG: "", VARIETY: "" },
  overrides: {}
};
let yuraScheduleConfig = YURA_SCHEDULE_DEFAULT_CONFIG;
let yuraScheduleTimer = null;

function yuraSchedulePositiveMod(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function yuraScheduleEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function yuraScheduleNormalizeConfig(raw) {
  const base = YURA_SCHEDULE_DEFAULT_CONFIG;
  const cfg = raw && typeof raw === "object" ? raw : {};
  return {
    ...base,
    ...cfg,
    shiftCycle: Array.isArray(cfg.shiftCycle) && cfg.shiftCycle.length ? cfg.shiftCycle : base.shiftCycle,
    weeklyRules: { ...base.weeklyRules, ...(cfg.weeklyRules || {}) },
    categoryArts: { ...base.categoryArts, ...(cfg.categoryArts || {}) },
    overrides: cfg.overrides && typeof cfg.overrides === "object" ? cfg.overrides : {}
  };
}

async function yuraScheduleLoadConfig() {
  try {
    const response = await fetch(`network-config.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    yuraScheduleConfig = yuraScheduleNormalizeConfig(await response.json());
  } catch (error) {
    yuraScheduleConfig = yuraScheduleNormalizeConfig(yuraScheduleConfig);
    console.warn("YURA Network schedule config unavailable; using local defaults.", error);
  }
  renderYuraLiveSchedule();
}

function yuraScheduleWarsawNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: YURA_SCHEDULE_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute),
    dateKey: `${map.year}-${map.month}-${map.day}`
  };
}

function yuraScheduleDateKey(utcMs) {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function yuraScheduleMondayUtc(year, month, day) {
  const utc = Date.UTC(year, month - 1, day);
  const weekday = new Date(utc).getUTCDay();
  return utc - ((weekday + 6) % 7) * YURA_SCHEDULE_DAY_MS;
}

function yuraScheduleAnchorUtc() {
  const raw = String(yuraScheduleConfig.anchorMonday || "2026-09-28");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Date.UTC(2026, 8, 28);
}

function yuraScheduleShiftForMonday(mondayUtc) {
  const cycle = Array.isArray(yuraScheduleConfig.shiftCycle) && yuraScheduleConfig.shiftCycle.length
    ? yuraScheduleConfig.shiftCycle.map(x => String(x).toUpperCase())
    : ["RANO", "NOCKA", "POPO"];
  const weeks = Math.round((mondayUtc - yuraScheduleAnchorUtc()) / YURA_SCHEDULE_WEEK_MS);
  return cycle[yuraSchedulePositiveMod(weeks, cycle.length)];
}

function yuraScheduleMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function yuraScheduleFormatMinutes(total) {
  if (total == null) return "";
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function yuraScheduleAutomaticWindow(dayIndex, shift, allowThursday = false) {
  if (dayIndex === 3 && !allowThursday) return { start: null, end: null, label: "OFF", isOff: true };
  if (dayIndex === 5) return { start: 16 * 60, end: 22 * 60, label: "16:00–22:00", isOff: false };
  if (dayIndex === 6) return { start: 16 * 60, end: 20 * 60, label: "16:00–20:00", isOff: false };
  if (shift === "POPO") return { start: 9 * 60, end: 12 * 60, label: "09:00–12:00", isOff: false };
  return { start: 17 * 60, end: 20 * 60, label: "17:00–20:00", isOff: false };
}

function yuraScheduleArtForCategory(category) {
  const wanted = String(category || "").trim().toLowerCase();
  const entries = Object.entries(yuraScheduleConfig.categoryArts || {});
  const match = entries.find(([key]) => String(key).trim().toLowerCase() === wanted);
  return match ? String(match[1] || "").trim() : "";
}

function yuraScheduleResolveDay(dayUtc, dayIndex, shift) {
  const key = yuraScheduleDateKey(dayUtc);
  const weekly = yuraScheduleConfig.weeklyRules?.[String(dayIndex)] || { enabled: dayIndex !== 3, category: yuraScheduleConfig.defaultCategory || "STREAM" };
  const override = yuraScheduleConfig.overrides?.[key] || {};
  let enabled = weekly.enabled !== false;
  let window = yuraScheduleAutomaticWindow(dayIndex, shift, dayIndex === 3 && enabled);
  if (window.isOff) enabled = false;

  if (override.enabled === true) {
    enabled = true;
    if (window.isOff) window = yuraScheduleAutomaticWindow(dayIndex, shift, true);
  } else if (override.enabled === false) {
    enabled = false;
  }

  let start = yuraScheduleMinutes(override.start);
  let end = yuraScheduleMinutes(override.end);
  if (start == null) start = window.start;
  if (end == null) end = window.end;
  if (!enabled || start == null || end == null || end <= start) {
    enabled = false;
    start = null;
    end = null;
  }

  const category = String(override.category || weekly.category || yuraScheduleConfig.defaultCategory || "STREAM").trim() || "STREAM";
  const artUrl = enabled ? String(override.artUrl || yuraScheduleArtForCategory(category) || "").trim() : "";
  return {
    key, enabled, start, end,
    label: enabled ? `${yuraScheduleFormatMinutes(start)}–${yuraScheduleFormatMinutes(end)}` : "OFF",
    category,
    artUrl,
    special: override.special === true,
    note: String(override.note || "").trim(),
    overridden: Object.keys(override).length > 0
  };
}

function yuraScheduleFormatShortDate(utcMs) {
  const d = new Date(utcMs);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yuraScheduleFormatLongDate(utcMs) {
  const d = new Date(utcMs);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

function yuraScheduleBuildDays(now) {
  const todayUtc = Date.UTC(now.year, now.month - 1, now.day);
  const days = [];
  for (let offset = 0; offset < 28; offset++) {
    const dayUtc = todayUtc + offset * YURA_SCHEDULE_DAY_MS;
    const jsDay = new Date(dayUtc).getUTCDay();
    const dayIndex = (jsDay + 6) % 7;
    const mondayUtc = dayUtc - dayIndex * YURA_SCHEDULE_DAY_MS;
    const shift = yuraScheduleShiftForMonday(mondayUtc);
    days.push({ dayUtc, dayIndex, shift, offset, ...yuraScheduleResolveDay(dayUtc, dayIndex, shift) });
  }
  return days;
}

function yuraScheduleEnsureStyles() {
  if (document.getElementById("yura-live-schedule-styles-v67")) return;
  const style = document.createElement("style");
  style.id = "yura-live-schedule-styles-v67";
  style.textContent = `
    .schedule-calendar-summary{margin-top:14px;padding:0;border:1px solid var(--line);border-radius:11px;background:linear-gradient(90deg,#0d1218,#0a0e13);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;overflow:hidden;box-shadow:var(--shadow)}
    .schedule-calendar-summary-main{padding:13px 15px;display:flex;align-items:center;gap:12px;min-width:0}.schedule-calendar-summary-dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 12px rgba(73,215,154,.55);flex:0 0 auto}.schedule-calendar-summary strong{font-size:12px;color:#e9eef5}.schedule-calendar-summary .schedule-live-next{font-size:14px;margin-left:8px}.schedule-calendar-config{display:flex;align-items:center;padding:0 15px;border-left:1px solid var(--line);color:#7f8b98;font:8px Consolas,monospace;white-space:nowrap}
    .schedule-calendar-head{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:18px 0 9px}.schedule-calendar-head span{color:#697583;font-size:8px;font-weight:900;letter-spacing:.14em}.schedule-calendar-head strong{display:block;color:#e7edf4;font-size:13px;margin-top:4px}.schedule-calendar-head .schedule-calendar-hint{text-align:right;font:8px Consolas,monospace;color:#596675}
    .schedule-calendar-weeks{display:grid;gap:12px}.schedule-calendar-week{border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,#0b1016,#090d12);box-shadow:var(--shadow);overflow:hidden}.schedule-calendar-week summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px}.schedule-calendar-week summary::-webkit-details-marker{display:none}.schedule-calendar-week summary:hover{background:rgba(255,255,255,.02)}.schedule-calendar-week[open] summary{border-bottom:1px solid var(--line)}
    .schedule-calendar-week-title{display:grid;gap:3px;min-width:0}.schedule-calendar-week-title span{color:#697583;font-size:8px;font-weight:900;letter-spacing:.14em}.schedule-calendar-week-title strong{display:block;color:#edf2f7;font-size:13px}.schedule-calendar-week-title em{font-style:normal;color:#92a0ae;font-size:9px}.schedule-calendar-week-toggle{display:inline-flex;align-items:center;gap:9px;color:#9ba8b5;font:8px Consolas,monospace;text-transform:uppercase;letter-spacing:.08em}.schedule-calendar-week-toggle::before{content:"▸";font-size:11px;line-height:1;transition:transform .15s ease}.schedule-calendar-week[open] .schedule-calendar-week-toggle::before{transform:rotate(90deg)}
    .schedule-calendar-week-body{padding:12px 14px 14px}.schedule-calendar-weekdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin-bottom:7px}.schedule-calendar-weekday{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#0b0f14;text-align:center;color:#aab3bd;font-size:9px;font-weight:900;letter-spacing:.08em}.schedule-calendar-weekday:first-child{color:#f1f4f8}.schedule-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}
    .schedule-calendar-card{position:relative;min-height:166px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0d1116;isolation:isolate;box-shadow:0 5px 18px rgba(0,0,0,.13);transition:transform .14s,border-color .14s,box-shadow .14s}.schedule-calendar-card:hover{transform:translateY(-1px);border-color:#394553}.schedule-calendar-card.has-art{background-size:cover;background-position:center}.schedule-calendar-card.has-art::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,8,12,.08) 5%,rgba(5,8,12,.18) 37%,rgba(5,8,12,.90) 78%,rgba(5,8,12,.98) 100%);z-index:0}.schedule-calendar-card.off{background:radial-gradient(circle at 50% 35%,rgba(48,58,70,.10),transparent 38%),#090c10}.schedule-calendar-card.today{border-color:rgba(73,215,154,.76);box-shadow:0 0 0 1px rgba(73,215,154,.11),0 8px 24px rgba(0,0,0,.20)}.schedule-calendar-card.live-now{border-color:rgba(73,215,154,.95);box-shadow:0 0 18px rgba(73,215,154,.12),0 8px 24px rgba(0,0,0,.22)}.schedule-calendar-card.near{border-top-color:rgba(242,140,24,.48)}
    .schedule-calendar-card-inner{position:relative;z-index:1;height:100%;min-height:166px;padding:10px 11px;display:flex;flex-direction:column}.schedule-calendar-card-top{display:flex;justify-content:space-between;gap:6px;align-items:flex-start}.schedule-calendar-day{font-size:12px;font-weight:900;letter-spacing:.05em;color:#f0f4f8;text-shadow:0 1px 5px #000}.schedule-calendar-date{font:8px Consolas,monospace;color:#c0c8d1;text-shadow:0 1px 4px #000}.schedule-calendar-card-bottom{margin-top:auto;display:grid;gap:4px}.schedule-calendar-category{font-size:16px;font-weight:850;color:#fff;text-shadow:0 1px 5px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.schedule-calendar-time{font:11px Consolas,monospace;font-weight:850;color:var(--accent)}.schedule-calendar-note{font-size:8px;line-height:1.28;color:#cbd3dd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.schedule-calendar-badge{display:inline-flex;width:max-content;max-width:100%;padding:3px 6px;border:1px solid rgba(242,140,24,.42);border-radius:999px;background:rgba(7,10,14,.76);color:var(--accent);font-size:7px;font-weight:900;letter-spacing:.07em}.schedule-calendar-badge.live{color:var(--green);border-color:rgba(73,215,154,.55)}.schedule-calendar-badge.weekend{color:#b9c3cf;border-color:#45515f}.schedule-calendar-off-center{margin:auto;display:grid;justify-items:center;gap:6px;text-align:center}.schedule-calendar-off-center strong{font-size:23px;color:#98a3b0;letter-spacing:.03em}.schedule-calendar-off-center span{font-size:9px;color:#687584}
    .schedule-calendar-range{color:#6d7987;font-size:8px;margin-top:8px}.schedule-calendar-range strong{color:#9ca7b3}.schedule-live-now{color:var(--green)!important}
    @media(max-width:900px){.schedule-calendar-summary{grid-template-columns:1fr}.schedule-calendar-config{border-left:0;border-top:1px solid var(--line);padding:9px 15px}.schedule-calendar-head{align-items:flex-start;flex-direction:column}.schedule-calendar-head .schedule-calendar-hint{text-align:left}.schedule-calendar-week summary{align-items:flex-start;flex-direction:column}.schedule-calendar-week-toggle{align-self:flex-end}.schedule-calendar-grid,.schedule-calendar-weekdays{grid-template-columns:repeat(2,minmax(0,1fr))}.schedule-calendar-card{min-height:152px}.schedule-calendar-card-inner{min-height:152px}}
  `;
  document.head.appendChild(style);
}

function yuraScheduleApplyArts(host) {
  host.querySelectorAll("[data-schedule-art]").forEach(card => {
    const art = card.getAttribute("data-schedule-art") || "";
    if (!art) return;
    const safe = art.replaceAll('"', '\\"');
    card.style.backgroundImage = `url("${safe}")`;
    card.classList.add("has-art");
  });
}

function yuraScheduleCardHtml(day, now) {
  const isToday = day.key === now.dateKey;
  const minutes = now.hour * 60 + now.minute;
  const liveNow = isToday && day.enabled && minutes >= day.start && minutes < day.end;
  const weekend = day.dayIndex === 5 || day.dayIndex === 6;
  const classes = ["schedule-calendar-card"];
  if (!day.enabled) classes.push("off");
  if (isToday) classes.push("today");
  if (liveNow) classes.push("live-now");
  if (day.offset < 7) classes.push("near");
  const artAttr = day.enabled ? yuraScheduleEscape(day.artUrl) : "";
  const note = yuraScheduleEscape(day.note);

  if (!day.enabled) {
    return `<article class="${classes.join(" ")}"><div class="schedule-calendar-card-inner"><div class="schedule-calendar-card-top"><span class="schedule-calendar-day">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</span><span class="schedule-calendar-date">${yuraScheduleFormatShortDate(day.dayUtc)}</span></div><div class="schedule-calendar-off-center"><strong>OFF</strong><span>Brak streama</span></div></div></article>`;
  }

  // Work-shift labels (RANO / POPO / NOCKA) are internal operator data and must never
  // leak onto the public schedule. Keep only viewer-facing state badges.
  let status = weekend ? "WEEKEND" : "";
  let badgeClass = weekend ? " weekend" : "";
  if (day.overridden) status = "OVERRIDE";
  if (day.special) status = "SPECIAL";
  if (liveNow) { status = "LIVE NOW"; badgeClass = " live"; }
  const badge = status ? `<span class="schedule-calendar-badge${badgeClass}">${yuraScheduleEscape(status)}</span>` : "";
  return `<article class="${classes.join(" ")}" data-schedule-art="${artAttr}"><div class="schedule-calendar-card-inner"><div class="schedule-calendar-card-top"><span class="schedule-calendar-day">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</span><span class="schedule-calendar-date">${yuraScheduleFormatShortDate(day.dayUtc)}</span></div><div class="schedule-calendar-card-bottom">${badge}<strong class="schedule-calendar-category">${yuraScheduleEscape(day.category)}</strong><span class="schedule-calendar-time ${liveNow ? "schedule-live-now" : ""}">${day.label}</span>${note ? `<span class="schedule-calendar-note">${note}</span>` : ""}</div></div></article>`;
}

function yuraScheduleWeekHtml(weekDays, now, weekIndex) {
  const start = weekDays[0];
  const end = weekDays[weekDays.length - 1];
  const open = weekIndex === 0 ? " open" : "";
  const enabledCount = weekDays.filter(day => day.enabled).length;
  const offCount = weekDays.length - enabledCount;
  const subtitle = weekIndex === 0 ? "Najbliższy tydzień widoczny od razu" : "Kliknij, aby rozwinąć tydzień";
  const weekdayHeaders = weekDays.map(day => `<div class="schedule-calendar-weekday">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</div>`).join("");
  return `<details class="schedule-calendar-week"${open}><summary><div class="schedule-calendar-week-title"><span>TYDZIEŃ ${weekIndex + 1} //</span><strong>${yuraScheduleFormatLongDate(start.dayUtc)} — ${yuraScheduleFormatLongDate(end.dayUtc)}</strong><em>${enabledCount} streamów • ${offCount} OFF • ${subtitle}</em></div><div class="schedule-calendar-week-toggle">${weekIndex === 0 ? "otwarty domyślnie" : "rozwiń / zwiń"}</div></summary><div class="schedule-calendar-week-body"><div class="schedule-calendar-weekdays">${weekdayHeaders}</div><div class="schedule-calendar-grid">${weekDays.map(day => yuraScheduleCardHtml(day, now)).join("")}</div></div></details>`;
}

function renderYuraLiveSchedule() {
  const host = document.getElementById("scheduleView");
  if (!host) return;
  yuraScheduleEnsureStyles();
  const now = yuraScheduleWarsawNowParts();
  const days = yuraScheduleBuildDays(now);
  const next = days.find(day => day.enabled && (day.offset > 0 || now.hour * 60 + now.minute < day.end));
  const nextLabel = next ? `${next.offset === 0 ? "DZIŚ" : YURA_SCHEDULE_DAY_NAMES[next.dayIndex]} • ${next.label} • ${next.category}` : "—";
  const updated = String(yuraScheduleConfig.updatedAt || "").trim();
  let updatedLabel = "AUTO CONFIG";
  if (updated) {
    const stamp = new Date(updated);
    if (!Number.isNaN(stamp.getTime())) updatedLabel = `CONFIG • ${stamp.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`;
  }
  const weeks = Array.from({ length: 4 }, (_, index) => days.slice(index * 7, index * 7 + 7));

  host.innerHTML = `
    <div class="hero"><div><div class="eyebrow">STREAM CALENDAR // 28 DAYS</div><h1>Harmonogram</h1><p>Najbliższe 28 dni w układzie tygodniowym. Pierwszy tydzień jest otwarty, kolejne rozwijasz z góry w dół.</p></div><div class="status-chip">AUTO • 28 DNI</div></div>
    <div class="schedule-calendar-summary"><div class="schedule-calendar-summary-main"><span class="schedule-calendar-summary-dot"></span><strong>Najbliższy stream:<span class="schedule-live-next">${yuraScheduleEscape(nextLabel)}</span></strong></div><div class="schedule-calendar-config">${yuraScheduleEscape(updatedLabel)}</div></div>
    <div class="schedule-calendar-head"><div><span>NAJBLIŻSZE 28 DNI //</span><strong>${yuraScheduleFormatLongDate(days[0].dayUtc)} — ${yuraScheduleFormatLongDate(days[days.length - 1].dayUtc)}</strong></div><div class="schedule-calendar-hint">4 TYGODNIE • 1 OTWARTY + 3 ZWIJANE</div></div>
    <div class="schedule-calendar-weeks">${weeks.map((weekDays, index) => yuraScheduleWeekHtml(weekDays, now, index)).join("")}</div>
    <div class="schedule-calendar-range">Pierwszy tydzień jest <strong>zawsze otwarty</strong>. Dni OFF nie używają artu.</div>`;
  yuraScheduleApplyArts(host);
}

function yuraScheduleStartAutoRefresh() {
  if (yuraScheduleTimer) window.clearInterval(yuraScheduleTimer);
  yuraScheduleLoadConfig();
  yuraScheduleTimer = window.setInterval(() => {
    if (!document.hidden) yuraScheduleLoadConfig();
  }, 60 * 1000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) yuraScheduleLoadConfig();
});

yuraScheduleStartAutoRefresh();
// YURA_PUBLIC_BOT_FILTER_V69
