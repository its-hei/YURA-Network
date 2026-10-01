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
  return `LAST SYNC \u2022 ${stamp.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`;
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
        isManagedMonthlyVip: item?.isManagedMonthlyVip === true,
        isMonthlyVipExcluded: typeof item?.isMonthlyVipExcluded === "boolean" ? item.isMonthlyVipExcluded : null,
        monthlyVipEligible: typeof item?.monthlyVipEligible === "boolean" ? item.monthlyVipEligible : null
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
        isManagedMonthlyVip: meta.isManagedMonthlyVip === true || item?.isManagedMonthlyVip === true,
        isMonthlyVipExcluded: typeof meta.isMonthlyVipExcluded === "boolean" ? meta.isMonthlyVipExcluded : item?.isMonthlyVipExcluded === true,
        monthlyVipEligible: typeof meta.monthlyVipEligible === "boolean" ? meta.monthlyVipEligible : item?.monthlyVipEligible === true
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

// YURA_PUBLIC_BOT_FILTER_V69

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html?v=333");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html?v=333";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html?v=335");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html?v=335";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html?v=337");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html?v=337";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html?v=339");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html?v=339";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_NAV_V77
function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;
  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","levels.html?v=340");
  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.href = "levels.html?v=340";
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}
if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) yuraLevelsNavObserver.disconnect();
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
}

// YURA_LEVELS_INTEGRATED_VIEW_V81
let yuraLevelsHost = null;
let yuraLevelsFrame = null;
let yuraLevelsHiddenChildren = [];

function yuraLevelsFindMainHost() {
  const direct = [
    document.querySelector("main"),
    document.querySelector('[role="main"]'),
    document.querySelector("#main"),
    document.querySelector("#content"),
    document.querySelector(".main-content"),
    document.querySelector(".content-main"),
    document.querySelector(".view-container")
  ].filter(Boolean);

  for (const el of direct) {
    const r = el.getBoundingClientRect();
    if (r.width >= 650 && r.height >= 350 && r.left >= 260) return el;
  }

  const visibleHeading = [...document.querySelectorAll("h1,h2")].find(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^(Komendy kanaĹ‚u|Ranking|O mnie|Harmonogram|Changelog)$/i.test(text);
  });

  if (!visibleHeading) return null;

  let node = visibleHeading.parentElement;
  while (node && node !== document.body) {
    const r = node.getBoundingClientRect();
    if (r.width >= 650 && r.height >= 350 && r.left >= 260) return node;
    node = node.parentElement;
  }
  return null;
}

function yuraLevelsSetNavActive(active) {
  const levels = document.querySelector("[data-yura-levels-nav='1']");
  if (!levels) return;

  const navItems = [...document.querySelectorAll("a,button,[data-view]")];
  if (active) {
    navItems.forEach(el => {
      if (el === levels) return;
      el.classList.remove("active","is-active","selected");
      el.removeAttribute("aria-current");
    });
    levels.classList.add("active");
    levels.setAttribute("aria-current","page");
  } else {
    levels.classList.remove("active","is-active","selected");
    levels.removeAttribute("aria-current");
  }
}

function yuraLevelsResizeFrame() {
  if (!yuraLevelsFrame) return;
  try {
    const doc = yuraLevelsFrame.contentDocument;
    if (!doc) return;
    const height = Math.max(
      620,
      doc.documentElement?.scrollHeight || 0,
      doc.body?.scrollHeight || 0
    );
    yuraLevelsFrame.style.height = `${height}px`;
  } catch {}
}

function yuraShowLevelsView(pushHistory = true) {
  const host = yuraLevelsFindMainHost();
  if (!host) {
    window.location.href = "levels.html?v=341";
    return;
  }

  if (yuraLevelsHost && yuraLevelsHost !== host)
    yuraHideLevelsView(false);

  yuraLevelsHost = host;

  if (!yuraLevelsFrame) {
    yuraLevelsHiddenChildren = [...host.children].map(el => ({
      el,
      display: el.style.display
    }));
    yuraLevelsHiddenChildren.forEach(x => x.el.style.display = "none");

    const frame = document.createElement("iframe");
    frame.id = "yura-levels-integrated-frame";
    frame.src = "levels.html?v=341&embed=1";
    frame.title = "Y.U.R.A. Levels";
    frame.style.cssText = [
      "display:block",
      "width:100%",
      "min-height:620px",
      "height:720px",
      "border:0",
      "background:transparent",
      "overflow:hidden"
    ].join(";");

    frame.addEventListener("load", () => {
      yuraLevelsResizeFrame();
      try {
        const doc = frame.contentDocument;
        if (doc?.body && "ResizeObserver" in window) {
          const observer = new ResizeObserver(() => yuraLevelsResizeFrame());
          observer.observe(doc.body);
          frame._yuraResizeObserver = observer;
        }
      } catch {}
    });

    host.appendChild(frame);
    yuraLevelsFrame = frame;
  }

  yuraLevelsSetNavActive(true);

  if (pushHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("yuraView","levels");
    history.pushState({ yuraView:"levels" }, "", url);
  }

  window.setTimeout(yuraLevelsResizeFrame, 120);
}

function yuraHideLevelsView(updateHistory = true) {
  if (yuraLevelsFrame) {
    try { yuraLevelsFrame._yuraResizeObserver?.disconnect?.(); } catch {}
    yuraLevelsFrame.remove();
    yuraLevelsFrame = null;
  }

  yuraLevelsHiddenChildren.forEach(x => {
    if (x?.el) x.el.style.display = x.display || "";
  });
  yuraLevelsHiddenChildren = [];
  yuraLevelsHost = null;
  yuraLevelsSetNavActive(false);

  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete("yuraView");
    history.replaceState({}, "", url);
  }
}

function yuraInstallLevelsNavLink() {
  if (document.querySelector("[data-yura-levels-nav='1']")) return true;

  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");
  if (clone.tagName === "A") clone.setAttribute("href","?yuraView=levels");

  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    yuraShowLevelsView(true);
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}

document.addEventListener("click", event => {
  if (!yuraLevelsFrame) return;
  const item = event.target?.closest?.("a,button,[data-view]");
  if (!item || item.matches("[data-yura-levels-nav='1']")) return;
  const text = String(item.textContent || "").replace(/\s+/g," ").trim();
  if (/^(Komendy|Ranking|O mnie|Harmonogram|Changelog)\b/i.test(text))
    yuraHideLevelsView(true);
}, true);

window.addEventListener("popstate", () => {
  const wantsLevels = new URL(window.location.href).searchParams.get("yuraView") === "levels";
  if (wantsLevels) yuraShowLevelsView(false);
  else yuraHideLevelsView(false);
});

if (!yuraInstallLevelsNavLink()) {
  const yuraLevelsNavObserver = new MutationObserver(() => {
    if (yuraInstallLevelsNavLink()) {
      const wantsLevels = new URL(window.location.href).searchParams.get("yuraView") === "levels";
      if (wantsLevels) window.setTimeout(() => yuraShowLevelsView(false), 50);
      yuraLevelsNavObserver.disconnect();
    }
  });
  yuraLevelsNavObserver.observe(document.documentElement,{childList:true,subtree:true});
  window.setTimeout(() => yuraLevelsNavObserver.disconnect(),15000);
} else {
  const wantsLevels = new URL(window.location.href).searchParams.get("yuraView") === "levels";
  if (wantsLevels) window.setTimeout(() => yuraShowLevelsView(false), 50);
}

// YURA_LIVE_SCHEDULE_V78
const YURA_SCHEDULE_TIME_ZONE = "Europe/Warsaw";
const YURA_SCHEDULE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const YURA_SCHEDULE_DAY_MS = 24 * 60 * 60 * 1000;
const YURA_SCHEDULE_DAY_NAMES = ["PON", "WT", "\u015AR", "CZW", "PT", "SOB", "ND"];
const YURA_SCHEDULE_DEFAULT_CONFIG = {
  schemaVersion: 1,
  timeZone: "Europe/Warsaw",
  anchorMonday: "2026-09-28",
  anchorShift: "RANO",
  shiftCycle: ["RANO", "NOCKA", "POPO"],
  defaultCategory: "FFXIV",
  publicLayout: "MODERN",
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
    publicLayout: (() => { const x = String(cfg.publicLayout || base.publicLayout).trim().toUpperCase(); return ["CLASSIC","MODERN","SLIM"].includes(x) ? x : "MODERN"; })(),
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
  if (dayIndex === 5) return { start: 16 * 60, end: 22 * 60, label: "16:00\u201322:00", isOff: false };
  if (dayIndex === 6) return { start: 16 * 60, end: 20 * 60, label: "16:00\u201320:00", isOff: false };
  if (shift === "POPO") return { start: 9 * 60, end: 12 * 60, label: "09:00\u201312:00", isOff: false };
  return { start: 17 * 60, end: 20 * 60, label: "17:00\u201320:00", isOff: false };
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
    label: enabled ? `${yuraScheduleFormatMinutes(start)}\u2013${yuraScheduleFormatMinutes(end)}` : "OFF",
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
  for (let offset = 0; offset < 25; offset++) {
    const dayUtc = todayUtc + offset * YURA_SCHEDULE_DAY_MS;
    const jsDay = new Date(dayUtc).getUTCDay();
    const dayIndex = (jsDay + 6) % 7;
    const mondayUtc = dayUtc - dayIndex * YURA_SCHEDULE_DAY_MS;
    const shift = yuraScheduleShiftForMonday(mondayUtc);
    days.push({ dayUtc, dayIndex, shift, offset, ...yuraScheduleResolveDay(dayUtc, dayIndex, shift) });
  }
  return days;
}

function yuraScheduleEnsureStyles(layout) {
  const wanted = String(layout || "MODERN").trim().toUpperCase();
  const selected = ["CLASSIC","MODERN","SLIM"].includes(wanted) ? wanted : "MODERN";
  let style = document.getElementById("yura-live-schedule-styles-v78");
  if (!style) {
    style = document.createElement("style");
    style.id = "yura-live-schedule-styles-v78";
    document.head.appendChild(style);
  }
  if (style.dataset.layout === selected) return;
  style.dataset.layout = selected;
  style.textContent = selected === "CLASSIC" ? `
    .schedule-calendar-summary{margin-top:14px;padding:0;border:1px solid var(--line);border-radius:11px;background:linear-gradient(90deg,#0d1218,#0a0e13);display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;overflow:hidden;box-shadow:var(--shadow)}
    .schedule-calendar-summary-main{padding:13px 15px;display:flex;align-items:center;gap:12px;min-width:0}.schedule-calendar-summary-dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 12px rgba(73,215,154,.55);flex:0 0 auto}.schedule-calendar-summary strong{font-size:12px;color:#e9eef5}.schedule-calendar-summary .schedule-live-next{font-size:14px;margin-left:8px}.schedule-calendar-config{display:flex;align-items:center;padding:0 15px;border-left:1px solid var(--line);color:#7f8b98;font:8px Consolas,monospace;white-space:nowrap}
    .schedule-calendar-head{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:18px 0 9px}.schedule-calendar-head span{color:#697583;font-size:8px;font-weight:900;letter-spacing:.14em}.schedule-calendar-head strong{display:block;color:#e7edf4;font-size:13px;margin-top:4px}.schedule-calendar-head .schedule-calendar-hint{text-align:right;font:8px Consolas,monospace;color:#596675}
    .schedule-calendar-weeks{display:grid;gap:12px}.schedule-calendar-week{border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,#0b1016,#090d12);box-shadow:var(--shadow);overflow:hidden}.schedule-calendar-week summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px}.schedule-calendar-week summary::-webkit-details-marker{display:none}.schedule-calendar-week summary:hover{background:rgba(255,255,255,.02)}.schedule-calendar-week[open] summary{border-bottom:1px solid var(--line)}
    .schedule-calendar-week-title{display:grid;gap:3px;min-width:0}.schedule-calendar-week-title span{color:#697583;font-size:8px;font-weight:900;letter-spacing:.14em}.schedule-calendar-week-title strong{display:block;color:#edf2f7;font-size:13px}.schedule-calendar-week-title em{font-style:normal;color:#92a0ae;font-size:9px}.schedule-calendar-week-toggle{display:inline-flex;align-items:center;gap:9px;color:#9ba8b5;font:8px Consolas,monospace;text-transform:uppercase;letter-spacing:.08em}.schedule-calendar-week-toggle::before{content:"\u25B8";font-size:11px;line-height:1;transition:transform .15s ease}.schedule-calendar-week[open] .schedule-calendar-week-toggle::before{transform:rotate(90deg)}
    .schedule-calendar-week-body{padding:12px 14px 14px}.schedule-calendar-weekdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px;margin-bottom:7px}.schedule-calendar-weekday{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#0b0f14;text-align:center;color:#aab3bd;font-size:9px;font-weight:900;letter-spacing:.08em}.schedule-calendar-weekday:first-child{color:#f1f4f8}.schedule-calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}
    .schedule-calendar-card{position:relative;min-height:166px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#0d1116;isolation:isolate;box-shadow:0 5px 18px rgba(0,0,0,.13);transition:transform .14s,border-color .14s,box-shadow .14s}.schedule-calendar-card:hover{transform:translateY(-1px);border-color:#394553}.schedule-calendar-card.has-art{background-size:cover;background-position:center}.schedule-calendar-card.has-art::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,8,12,.08) 5%,rgba(5,8,12,.18) 37%,rgba(5,8,12,.90) 78%,rgba(5,8,12,.98) 100%);z-index:0}.schedule-calendar-card.off{background:radial-gradient(circle at 50% 35%,rgba(48,58,70,.10),transparent 38%),#090c10}.schedule-calendar-card.today{border-color:rgba(73,215,154,.76);box-shadow:0 0 0 1px rgba(73,215,154,.11),0 8px 24px rgba(0,0,0,.20)}.schedule-calendar-card.live-now{border-color:rgba(73,215,154,.95);box-shadow:0 0 18px rgba(73,215,154,.12),0 8px 24px rgba(0,0,0,.22)}.schedule-calendar-card.near{border-top-color:rgba(242,140,24,.48)}
    .schedule-calendar-card-inner{position:relative;z-index:1;height:100%;min-height:166px;padding:10px 11px;display:flex;flex-direction:column}.schedule-calendar-card-top{display:flex;justify-content:space-between;gap:6px;align-items:flex-start}.schedule-calendar-day{font-size:12px;font-weight:900;letter-spacing:.05em;color:#f0f4f8;text-shadow:0 1px 5px #000}.schedule-calendar-date{font:8px Consolas,monospace;color:#c0c8d1;text-shadow:0 1px 4px #000}.schedule-calendar-card-bottom{margin-top:auto;display:grid;gap:4px}.schedule-calendar-category{font-size:16px;font-weight:850;color:#fff;text-shadow:0 1px 5px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.schedule-calendar-time{font:11px Consolas,monospace;font-weight:850;color:var(--accent)}.schedule-calendar-note{font-size:8px;line-height:1.28;color:#cbd3dd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.schedule-calendar-badge{display:inline-flex;width:max-content;max-width:100%;padding:3px 6px;border:1px solid rgba(242,140,24,.42);border-radius:999px;background:rgba(7,10,14,.76);color:var(--accent);font-size:7px;font-weight:900;letter-spacing:.07em}.schedule-calendar-badge.live{color:var(--green);border-color:rgba(73,215,154,.55)}.schedule-calendar-badge.weekend{color:#b9c3cf;border-color:#45515f}.schedule-calendar-off-center{margin:auto;display:grid;justify-items:center;gap:6px;text-align:center}.schedule-calendar-off-center strong{font-size:23px;color:#98a3b0;letter-spacing:.03em}.schedule-calendar-off-center span{font-size:9px;color:#687584}
    .schedule-calendar-range{color:#6d7987;font-size:8px;margin-top:8px}.schedule-calendar-range strong{color:#9ca7b3}.schedule-live-now{color:var(--green)!important}
    @media(max-width:900px){.schedule-calendar-summary{grid-template-columns:1fr}.schedule-calendar-config{border-left:0;border-top:1px solid var(--line);padding:9px 15px}.schedule-calendar-head{align-items:flex-start;flex-direction:column}.schedule-calendar-head .schedule-calendar-hint{text-align:left}.schedule-calendar-week summary{align-items:flex-start;flex-direction:column}.schedule-calendar-week-toggle{align-self:flex-end}.schedule-calendar-grid,.schedule-calendar-weekdays{grid-template-columns:repeat(2,minmax(0,1fr))}.schedule-calendar-card{min-height:152px}.schedule-calendar-card-inner{min-height:152px}}
  ` : `
    .schedule-showcase{position:relative;isolation:isolate;margin-top:2px;padding:22px;border:1px solid rgba(75,112,150,.28);border-radius:18px;background:radial-gradient(circle at 88% 0%,rgba(51,145,255,.10),transparent 31%),radial-gradient(circle at 4% 100%,rgba(242,140,24,.10),transparent 30%),linear-gradient(180deg,rgba(10,15,22,.985),rgba(7,10,15,.995));box-shadow:0 24px 70px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.025);overflow:hidden}
    .schedule-showcase::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:linear-gradient(90deg,rgba(53,148,255,.24),rgba(53,148,255,0) 24%,rgba(242,140,24,0) 72%,rgba(242,140,24,.22));height:2px;opacity:.9}
    .schedule-showcase .hero{margin:0;padding:0 0 18px;border-bottom:1px solid rgba(79,111,145,.20)}
    .schedule-showcase .hero h1{letter-spacing:-.035em}.schedule-showcase .hero p{max-width:720px}
    .schedule-showcase .status-chip{border-color:rgba(56,151,255,.52);background:linear-gradient(90deg,rgba(38,124,219,.15),rgba(242,140,24,.10));color:#78baff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.02),0 0 18px rgba(54,147,255,.06)}
    .schedule-calendar-summary{margin-top:18px;padding:0;border:1px solid rgba(68,109,151,.30);border-radius:12px;background:linear-gradient(90deg,rgba(12,21,31,.97),rgba(12,16,22,.98) 62%,rgba(24,17,10,.96));display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;overflow:hidden;box-shadow:0 10px 28px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.022)}
    .schedule-calendar-summary-main{padding:14px 17px;display:flex;align-items:center;gap:12px;min-width:0}.schedule-calendar-summary-dot{width:9px;height:9px;border-radius:50%;background:#3c9cff;box-shadow:0 0 14px rgba(60,156,255,.72);flex:0 0 auto}.schedule-calendar-summary strong{font-size:11px;color:#dfeaf6;letter-spacing:.04em}.schedule-calendar-summary .schedule-live-next{font-size:14px;margin-left:8px;color:#fff}.schedule-calendar-config{display:flex;align-items:center;padding:0 16px;border-left:1px solid rgba(84,111,139,.20);color:#73879b;font:8px Consolas,monospace;white-space:nowrap}
    .schedule-calendar-head{display:flex;justify-content:space-between;align-items:end;gap:18px;margin:20px 0 10px}.schedule-calendar-head span{color:#70869b;font-size:8px;font-weight:900;letter-spacing:.16em}.schedule-calendar-head strong{display:block;color:#edf4fb;font-size:13px;margin-top:4px}.schedule-calendar-head .schedule-calendar-hint{text-align:right;font:8px Consolas,monospace;color:#61778e}
    .schedule-calendar-weeks{display:grid;gap:12px}.schedule-calendar-week{border:1px solid rgba(69,101,133,.24);border-radius:14px;background:linear-gradient(180deg,rgba(10,15,21,.99),rgba(7,11,16,.995));box-shadow:0 12px 30px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.018);overflow:hidden;transition:border-color .16s ease,box-shadow .16s ease}.schedule-calendar-week:hover{border-color:rgba(74,135,195,.38)}.schedule-calendar-week.featured{border-color:rgba(66,137,205,.38);box-shadow:0 16px 42px rgba(0,0,0,.20),inset 0 1px 0 rgba(255,255,255,.024)}
    .schedule-calendar-week summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 16px}.schedule-calendar-week summary::-webkit-details-marker{display:none}.schedule-calendar-week summary:hover{background:rgba(61,148,239,.025)}.schedule-calendar-week[open] summary{border-bottom:1px solid rgba(76,106,136,.20)}
    .schedule-calendar-week-title{display:grid;gap:3px;min-width:0}.schedule-calendar-week-title span{color:#6e86a0;font-size:8px;font-weight:900;letter-spacing:.16em}.schedule-calendar-week-title strong{display:block;color:#f0f5fb;font-size:13px}.schedule-calendar-week-title em{font-style:normal;color:#8597a8;font-size:9px}.schedule-calendar-week-toggle{display:inline-flex;align-items:center;gap:9px;color:#7ea8d1;font:8px Consolas,monospace;text-transform:uppercase;letter-spacing:.09em}.schedule-calendar-week-toggle::before{content:"\\25B8";font-size:11px;line-height:1;transition:transform .15s ease}.schedule-calendar-week[open] .schedule-calendar-week-toggle::before{transform:rotate(90deg)}
    .schedule-calendar-week-body{padding:16px 18px 18px}.schedule-calendar-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
    .schedule-calendar-card{--cat:#4f9cff;position:relative;min-width:0;border:1px solid rgba(242,140,24,.36);border-radius:13px;background:linear-gradient(180deg,#0e141c,#090e14);padding:10px;display:grid;grid-template-rows:auto 136px minmax(94px,auto);gap:9px;box-shadow:0 10px 26px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.024);transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease;overflow:hidden}.schedule-calendar-card::before{content:"";position:absolute;inset:0;z-index:4;pointer-events:none;border-radius:13px;background:linear-gradient(#f28c18,#f28c18) left top/28px 2px no-repeat,linear-gradient(#f28c18,#f28c18) right top/28px 2px no-repeat,linear-gradient(#f28c18,#f28c18) left bottom/28px 2px no-repeat,linear-gradient(#f28c18,#f28c18) right bottom/28px 2px no-repeat,linear-gradient(#f28c18,#f28c18) left top/2px 22px no-repeat,linear-gradient(#f28c18,#f28c18) right top/2px 22px no-repeat,linear-gradient(#f28c18,#f28c18) left bottom/2px 22px no-repeat,linear-gradient(#f28c18,#f28c18) right bottom/2px 22px no-repeat;opacity:.70}.schedule-calendar-card::after{content:"";position:absolute;left:28px;right:28px;bottom:0;height:2px;background:linear-gradient(90deg,rgba(242,140,24,.12),rgba(242,140,24,.78) 50%,rgba(242,140,24,.12));opacity:.55}.schedule-calendar-card:hover{transform:translateY(-2px);border-color:rgba(242,140,24,.66);box-shadow:0 14px 34px rgba(0,0,0,.28),0 0 20px rgba(242,140,24,.07)}.schedule-calendar-card.near{border-top-color:rgba(242,140,24,.58)}
    .schedule-calendar-card.today{border-color:rgba(242,140,24,.66);box-shadow:0 0 0 1px rgba(242,140,24,.08),0 14px 32px rgba(0,0,0,.27)}.schedule-calendar-card.today::after{background:linear-gradient(90deg,rgba(242,140,24,.12),rgba(242,140,24,.88) 50%,rgba(242,140,24,.12));opacity:.78}.schedule-calendar-card.live-now{border:2px solid #49d79a;box-shadow:0 0 0 1px rgba(73,215,154,.18),0 0 30px rgba(73,215,154,.18),0 15px 34px rgba(0,0,0,.30)}.schedule-calendar-card.live-now::before{opacity:1;background:linear-gradient(#49d79a,#49d79a) left top/28px 2px no-repeat,linear-gradient(#49d79a,#49d79a) right top/28px 2px no-repeat,linear-gradient(#49d79a,#49d79a) left bottom/28px 2px no-repeat,linear-gradient(#49d79a,#49d79a) right bottom/28px 2px no-repeat,linear-gradient(#49d79a,#49d79a) left top/2px 22px no-repeat,linear-gradient(#49d79a,#49d79a) right top/2px 22px no-repeat,linear-gradient(#49d79a,#49d79a) left bottom/2px 22px no-repeat,linear-gradient(#49d79a,#49d79a) right bottom/2px 22px no-repeat}.schedule-calendar-card.live-now::after{background:linear-gradient(90deg,rgba(73,215,154,.12),#49d79a 50%,rgba(73,215,154,.12));opacity:.92}.schedule-calendar-live-frame{position:static;z-index:6;display:inline-flex;align-items:center;justify-content:center;width:max-content;margin:0 auto 3px;padding:3px 10px;border:1px solid #49d79a;border-radius:999px;background:linear-gradient(180deg,#123c2d,#0b271d);color:#8ff0c5;font:8px Consolas,monospace;font-weight:950;line-height:1;letter-spacing:.14em;box-shadow:0 4px 14px rgba(73,215,154,.16)}.schedule-calendar-card.off{grid-template-rows:auto 1fr;background:radial-gradient(circle at 50% 45%,rgba(64,90,117,.08),transparent 38%),linear-gradient(180deg,#0b1118,#080c11);border-color:rgba(242,140,24,.22)}
    .schedule-calendar-card-top{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:1px;min-height:32px}.schedule-calendar-day{font-size:12px;font-weight:900;letter-spacing:.06em;color:#f4f7fb}.schedule-calendar-date{font:8px Consolas,monospace;color:#8797a8}.schedule-calendar-art{position:relative;border:1px solid rgba(75,103,132,.34);border-radius:8px;background:linear-gradient(135deg,#141d27,#0b1118);background-size:cover;background-position:center;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.012)}.schedule-calendar-art::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,7,10,.01),rgba(4,7,10,.08) 55%,rgba(4,7,10,.36));pointer-events:none}
    .schedule-calendar-card-bottom{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:5px;min-width:0;text-align:center}.schedule-calendar-time{display:grid;justify-items:center;gap:0;font-family:Consolas,monospace;color:#eaf2fb;line-height:1}.schedule-calendar-time strong{display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;font-size:15px;font-weight:950;color:#fff}.schedule-calendar-time-sep{color:#91a0af;font-weight:800}.schedule-calendar-category{display:inline-flex;max-width:100%;padding:5px 10px;border:1px solid color-mix(in srgb,var(--cat) 70%,#fff 0%);border-radius:7px;background:linear-gradient(180deg,color-mix(in srgb,var(--cat) 92%,#fff 2%),color-mix(in srgb,var(--cat) 78%,#05080c 22%));color:#06101a;font-size:8px;font-weight:950;line-height:1;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 5px 14px color-mix(in srgb,var(--cat) 18%,transparent)}.schedule-calendar-note{font-size:8px;line-height:1.25;color:#8495a6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.schedule-calendar-badge{display:inline-flex;width:max-content;max-width:100%;padding:3px 7px;border:1px solid rgba(242,140,24,.52);border-radius:999px;background:rgba(30,17,5,.72);color:#ffab49;font-size:7px;font-weight:950;letter-spacing:.08em}.schedule-calendar-badge.live{color:#8ff0c5;border-color:rgba(73,215,154,.66);background:rgba(10,48,34,.78)}.schedule-calendar-badge.weekend{color:#9eacba;border-color:#46586c;background:rgba(13,18,25,.78)}
    .schedule-calendar-off-center{margin:auto;display:grid;justify-items:center;gap:5px;text-align:center}.schedule-calendar-off-center::before{content:"\\263E";font-size:28px;color:#617488;line-height:1}.schedule-calendar-off-center strong{font-size:22px;color:#96a4b2;letter-spacing:.03em}.schedule-calendar-off-center span{font-size:9px;color:#627182}.schedule-live-now{color:#79e8b8!important}
    .schedule-calendar-range{color:#60758a;font-size:8px;margin-top:10px;text-align:right}.schedule-calendar-range strong{color:#91a8be}
    @media(max-width:1120px){.schedule-calendar-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:900px){.schedule-showcase{padding:16px;border-radius:15px}.schedule-calendar-summary{grid-template-columns:1fr}.schedule-calendar-config{border-left:0;border-top:1px solid rgba(75,103,132,.24);padding:9px 15px}.schedule-calendar-head{align-items:flex-start;flex-direction:column}.schedule-calendar-head .schedule-calendar-hint{text-align:left}.schedule-calendar-week summary{align-items:flex-start}.schedule-calendar-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:620px){.schedule-showcase{padding:12px}.schedule-calendar-grid{display:grid;grid-template-columns:1fr;gap:8px}.schedule-calendar-card{grid-template-columns:62px 76px minmax(0,1fr);grid-template-rows:auto;align-items:center;min-height:86px;padding:8px;gap:9px}.schedule-calendar-card-top{display:grid;justify-items:start;align-content:center;gap:2px;min-height:0}.schedule-calendar-art{height:62px}.schedule-calendar-card-bottom{align-items:flex-start;justify-content:center;text-align:left;gap:4px}.schedule-calendar-time{justify-items:start}.schedule-calendar-time strong{font-size:13px}.schedule-calendar-card.off{grid-template-columns:62px minmax(0,1fr);grid-template-rows:auto;min-height:80px}.schedule-calendar-card.off .schedule-calendar-off-center{grid-auto-flow:column;align-items:center;justify-content:start;margin:0;gap:8px}.schedule-calendar-card.off .schedule-calendar-off-center::before{font-size:20px}.schedule-calendar-card.off .schedule-calendar-off-center strong{font-size:16px}.schedule-calendar-week-body{padding:10px}.schedule-calendar-category{font-size:8px}.schedule-calendar-week-title em{display:none}}
  `;
  if (selected === "SLIM") {
    style.textContent += `
      .schedule-calendar-week-body{padding:16px 22px 18px}
      .schedule-calendar-grid{grid-template-columns:repeat(5,minmax(132px,154px));justify-content:space-between;gap:13px}
      .schedule-calendar-card{min-height:310px;padding:8px;grid-template-rows:auto 170px minmax(72px,auto);gap:7px;border-radius:14px}
      .schedule-calendar-card.off{min-height:310px;grid-template-rows:auto 1fr}
      .schedule-calendar-card-top{min-height:36px}
      .schedule-calendar-day{font-size:13px}.schedule-calendar-date{font-size:8px}
      .schedule-calendar-art{border-radius:9px}
      .schedule-calendar-card-bottom{gap:6px;justify-content:flex-start}
      .schedule-calendar-time strong{font-size:14px;gap:4px}
      .schedule-calendar-category{max-width:92%;padding:5px 8px}
      .schedule-calendar-badge{margin-top:0}
      @media(max-width:1120px){.schedule-calendar-grid{grid-template-columns:repeat(3,minmax(134px,156px));justify-content:center;gap:14px}}
      @media(max-width:900px){.schedule-calendar-grid{grid-template-columns:repeat(2,minmax(138px,160px));justify-content:center}}
      @media(max-width:620px){.schedule-calendar-week-body{padding:10px}.schedule-calendar-grid{grid-template-columns:1fr;gap:8px}.schedule-calendar-card{grid-template-columns:62px 76px minmax(0,1fr);grid-template-rows:auto;align-items:center;min-height:86px;padding:8px;gap:9px}.schedule-calendar-card.off{grid-template-columns:62px minmax(0,1fr);grid-template-rows:auto;min-height:80px}.schedule-calendar-art{height:62px}.schedule-calendar-card-top{min-height:0}.schedule-calendar-card-bottom{gap:4px}.schedule-calendar-time strong{font-size:13px}}
    `;
  }
}

function yuraScheduleApplyClassicArts(host) {
  host.querySelectorAll("[data-schedule-art]").forEach(card => {
    const art = card.getAttribute("data-schedule-art") || "";
    if (!art) return;
    const safe = art.replaceAll('"', '\\"');
    card.style.backgroundImage = `url("${safe}")`;
    card.classList.add("has-art");
  });
}

function yuraScheduleClassicCardHtml(day, now) {
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
  if (day.overridden) status = "BONUS";
  if (day.special) status = "SPECIAL";
  if (liveNow) { status = "LIVE"; badgeClass = " live"; }
  const badge = status ? `<span class="schedule-calendar-badge${badgeClass}">${yuraScheduleEscape(status)}</span>` : "";
  const timeRange = `${yuraScheduleEscape(yuraScheduleFormatMinutes(day.start))}&ndash;${yuraScheduleEscape(yuraScheduleFormatMinutes(day.end))}`;
  return `<article class="${classes.join(" ")}" data-schedule-art="${artAttr}"><div class="schedule-calendar-card-inner"><div class="schedule-calendar-card-top"><span class="schedule-calendar-day">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</span><span class="schedule-calendar-date">${yuraScheduleFormatShortDate(day.dayUtc)}</span></div><div class="schedule-calendar-card-bottom">${badge}<strong class="schedule-calendar-category">${yuraScheduleEscape(day.category)}</strong><span class="schedule-calendar-time ${liveNow ? "schedule-live-now" : ""}">${timeRange}</span>${note ? `<span class="schedule-calendar-note">${note}</span>` : ""}</div></div></article>`;
}

function yuraScheduleClassicWeekHtml(weekDays, now, weekIndex) {
  const start = weekDays[0];
  const end = weekDays[weekDays.length - 1];
  const open = weekIndex === 0 ? " open" : "";
  const enabledCount = weekDays.filter(day => day.enabled).length;
  const offCount = weekDays.length - enabledCount;
  const subtitle = weekIndex === 0 ? "Najbli\u017Cszy tydzie\u0144 widoczny od razu" : "Kliknij, aby rozwin\u0105\u0107 tydzie\u0144";
  const weekdayHeaders = weekDays.map(day => `<div class="schedule-calendar-weekday">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</div>`).join("");
  return `<details class="schedule-calendar-week"${open}><summary><div class="schedule-calendar-week-title"><span>TYDZIE\u0143 ${weekIndex + 1} //</span><strong>${yuraScheduleFormatLongDate(start.dayUtc)} \u2014 ${yuraScheduleFormatLongDate(end.dayUtc)}</strong><em>${enabledCount} stream\u00F3w \u2022 ${offCount} OFF \u2022 ${subtitle}</em></div><div class="schedule-calendar-week-toggle">${weekIndex === 0 ? "otwarty domy\u015Blnie" : "rozwi\u0144 / zwi\u0144"}</div></summary><div class="schedule-calendar-week-body"><div class="schedule-calendar-weekdays">${weekdayHeaders}</div><div class="schedule-calendar-grid">${weekDays.map(day => yuraScheduleClassicCardHtml(day, now)).join("")}</div></div></details>`;
}

function renderYuraLiveScheduleClassic() {
  const host = document.getElementById("scheduleView");
  if (!host) return;
  
  const now = yuraScheduleWarsawNowParts();
  const days = yuraScheduleBuildDays(now);
  const next = days.find(day => day.enabled && (day.offset > 0 || now.hour * 60 + now.minute < day.end));
  const nextLabel = next ? `${next.offset === 0 ? "DZI\u015A" : YURA_SCHEDULE_DAY_NAMES[next.dayIndex]} \u2022 ${next.label} \u2022 ${next.category}` : "\u2014";
  const updated = String(yuraScheduleConfig.updatedAt || "").trim();
  let updatedLabel = "AUTO CONFIG";
  if (updated) {
    const stamp = new Date(updated);
    if (!Number.isNaN(stamp.getTime())) updatedLabel = `CONFIG \u2022 ${stamp.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`;
  }
  const weeks = Array.from({ length: 4 }, (_, index) => days.slice(index * 7, index * 7 + 7));

  host.innerHTML = `
    <div class="hero"><div><div class="eyebrow">STREAM CALENDAR // 25 DAYS</div><h1>Harmonogram</h1><p>Najbli\u017Csze 25 dni w uk\u0142adzie tygodniowym. Pierwszy tydzie\u0144 jest otwarty, kolejne rozwijasz z g\u00F3ry w d\u00F3\u0142.</p></div><div class="status-chip">25 DNI</div></div>
    <div class="schedule-calendar-summary"><div class="schedule-calendar-summary-main"><span class="schedule-calendar-summary-dot"></span><strong>Najbli\u017Cszy stream:<span class="schedule-live-next">${yuraScheduleEscape(nextLabel)}</span></strong></div><div class="schedule-calendar-config">${yuraScheduleEscape(updatedLabel)}</div></div>
    <div class="schedule-calendar-head"><div><span>NAJBLI\u017BSZE 25 DNI //</span><strong>${yuraScheduleFormatLongDate(days[0].dayUtc)} \u2014 ${yuraScheduleFormatLongDate(days[days.length - 1].dayUtc)}</strong></div><div class="schedule-calendar-hint">4 TYGODNIE \u2022 1 OTWARTY + 3 ZWIJANE</div></div>
    <div class="schedule-calendar-weeks">${weeks.map((weekDays, index) => yuraScheduleClassicWeekHtml(weekDays, now, index)).join("")}</div>
    <div class="schedule-calendar-range">Pierwszy tydzie\u0144 jest <strong>zawsze otwarty</strong>. Dni OFF nie u\u017Cywaj\u0105 artu.</div>`;
  yuraScheduleApplyClassicArts(host);
}

function yuraScheduleApplyModernArts(host) {
  host.querySelectorAll("[data-schedule-art]").forEach(artHost => {
    const art = artHost.getAttribute("data-schedule-art") || "";
    if (!art) return;
    const safe = art.replaceAll('"', '\\"');
    artHost.style.backgroundImage = `url("${safe}")`;
  });
}

function yuraScheduleCategoryColor(category) {
  const key = String(category || "").trim().toUpperCase();
  if (key.includes("FFXIV") || key.includes("FINAL FANTASY")) return "#4f9cff";
  if (key.includes("TIBIA")) return "#f28c18";
  if (key.includes("MMO")) return "#358fe8";
  if (key.includes("RPG")) return "#f28c18";
  if (key.includes("VARIETY")) return "#ff9b2f";
  if (key.includes("CHAT")) return "#5aa7f5";
  if (key.includes("SPECIAL") || key.includes("EVENT")) return "#f28c18";
  return "#5b8fbe";
}

function yuraScheduleModernCardHtml(day, now) {
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
    return `<article class="${classes.join(" ")}"><div class="schedule-calendar-card-top"><span class="schedule-calendar-day">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</span><span class="schedule-calendar-date">${yuraScheduleFormatShortDate(day.dayUtc)}</span></div><div class="schedule-calendar-off-center"><strong>OFF</strong><span>Brak streama</span></div></article>`;
  }

  // Work-shift labels are internal operator data and never appear on the public schedule.
  let status = weekend ? "WEEKEND" : "";
  let badgeClass = weekend ? " weekend" : "";
  if (isToday) { status = "DZISIAJ"; badgeClass = ""; }
  if (day.overridden) status = "BONUS";
  if (day.special) status = "SPECIAL";
  if (liveNow) { status = "LIVE"; badgeClass = " live"; }
  const badge = status ? `<span class="schedule-calendar-badge${badgeClass}">${yuraScheduleEscape(status)}</span>` : "";
  const color = yuraScheduleCategoryColor(day.category);
  const startText = yuraScheduleEscape(yuraScheduleFormatMinutes(day.start));
  const endText = yuraScheduleEscape(yuraScheduleFormatMinutes(day.end));
  const timeHtml = `<span class="schedule-calendar-time ${liveNow ? "schedule-live-now" : ""}"><strong>${startText}<span class="schedule-calendar-time-sep">&ndash;</span>${endText}</strong></span>`;
  return `<article class="${classes.join(" ")}" style="--cat:${color}"><div class="schedule-calendar-card-top">${liveNow ? `<span class="schedule-calendar-live-frame">LIVE</span>` : ""}<span class="schedule-calendar-day">${YURA_SCHEDULE_DAY_NAMES[day.dayIndex]}</span><span class="schedule-calendar-date">${yuraScheduleFormatShortDate(day.dayUtc)}</span></div><div class="schedule-calendar-art" data-schedule-art="${artAttr}"></div><div class="schedule-calendar-card-bottom">${timeHtml}<strong class="schedule-calendar-category">${yuraScheduleEscape(day.category)}</strong>${badge}${note ? `<span class="schedule-calendar-note">${note}</span>` : ""}</div></article>`;
}

function yuraScheduleModernWeekHtml(weekDays, now, weekIndex) {
  const start = weekDays[0];
  const end = weekDays[weekDays.length - 1];
  const open = weekIndex === 0 ? " open" : "";
  const featured = weekIndex === 0 ? " featured" : "";
  const enabledCount = weekDays.filter(day => day.enabled).length;
  const offCount = weekDays.length - enabledCount;
  const subtitle = weekIndex === 0 ? "Najbli\u017Csze 5 dni widoczne od razu" : "Kliknij, aby rozwin\u0105\u0107 kolejne dni";
  return `<details class="schedule-calendar-week${featured}"${open}><summary><div class="schedule-calendar-week-title"><span>BLOK ${weekIndex + 1} // ${weekDays.length} DNI</span><strong>${yuraScheduleFormatLongDate(start.dayUtc)} \u2014 ${yuraScheduleFormatLongDate(end.dayUtc)}</strong><em>${enabledCount} stream\u00F3w \u2022 ${offCount} OFF \u2022 ${subtitle}</em></div><div class="schedule-calendar-week-toggle">${weekIndex === 0 ? "otwarty domy\u015Blnie" : "rozwi\u0144 / zwi\u0144"}</div></summary><div class="schedule-calendar-week-body"><div class="schedule-calendar-grid">${weekDays.map(day => yuraScheduleModernCardHtml(day, now)).join("")}</div></div></details>`;
}

function renderYuraLiveScheduleModern() {
  const host = document.getElementById("scheduleView");
  if (!host) return;
  
  const now = yuraScheduleWarsawNowParts();
  const days = yuraScheduleBuildDays(now);
  const next = days.find(day => day.enabled && (day.offset > 0 || now.hour * 60 + now.minute < day.end));
  const nextLabel = next ? `${next.offset === 0 ? "DZI\u015A" : YURA_SCHEDULE_DAY_NAMES[next.dayIndex]} \u2022 ${next.label} \u2022 ${next.category}` : "\u2014";
  const updated = String(yuraScheduleConfig.updatedAt || "").trim();
  let updatedLabel = "AUTO CONFIG";
  if (updated) {
    const stamp = new Date(updated);
    if (!Number.isNaN(stamp.getTime())) updatedLabel = `CONFIG \u2022 ${stamp.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}`;
  }
  const weeks = Array.from({ length: 5 }, (_, index) => days.slice(index * 5, index * 5 + 5));
  const layoutName = String(yuraScheduleConfig.publicLayout || "MODERN").trim().toUpperCase() === "SLIM" ? "SLIM" : "MODERN";

  host.innerHTML = `
    <section class="schedule-showcase">
      <div class="hero"><div><div class="eyebrow">Y.U.R.A. NETWORK // LIVE SCHEDULE</div><h1>Harmonogram</h1><p>Najbli\u017Csze 25 dni w wi\u0119kszych kartach po 5 dni na panel. Pierwszy blok jest pokazany od razu, kolejne mo\u017Cesz rozwin\u0105\u0107.</p></div><div class="status-chip">LIVE SCHEDULE</div></div>
      <div class="schedule-calendar-summary"><div class="schedule-calendar-summary-main"><span class="schedule-calendar-summary-dot"></span><strong>NAJBLI\u017BSZY STREAM<span class="schedule-live-next">${yuraScheduleEscape(nextLabel)}</span></strong></div><div class="schedule-calendar-config">${yuraScheduleEscape(updatedLabel)}</div></div>
      <div class="schedule-calendar-head"><div><span>STREAM CALENDAR // 25 DAYS</span><strong>${yuraScheduleFormatLongDate(days[0].dayUtc)} \u2014 ${yuraScheduleFormatLongDate(days[days.length - 1].dayUtc)}</strong></div><div class="schedule-calendar-hint">AUTO-UPDATE \u2022 EUROPE/WARSAW</div></div>
      <div class="schedule-calendar-weeks">${weeks.map((weekDays, index) => yuraScheduleModernWeekHtml(weekDays, now, index)).join("")}</div>
      <div class="schedule-calendar-range">Harmonogram aktualizuje si\u0119 automatycznie. <strong>${layoutName === "SLIM" ? "SLIM pokazuje wyĹĽsze i wÄ™ĹĽsze karty" : "MODERN pokazuje 5 wiÄ™kszych kart na panel"}; dni OFF pozostajÄ… bez grafiki.</strong></div>
    </section>`;
  yuraScheduleApplyModernArts(host);
}

function renderYuraLiveSchedule() {
  const rawLayout = String(yuraScheduleConfig.publicLayout || "MODERN").trim().toUpperCase();
  const layout = ["CLASSIC","MODERN","SLIM"].includes(rawLayout) ? rawLayout : "MODERN";
  yuraScheduleEnsureStyles(layout);
  if (layout === "CLASSIC") renderYuraLiveScheduleClassic();
  else renderYuraLiveScheduleModern();
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
// YURA_LEVELS_NATIVE_VIEW_V82
const YURA_LEVELS_CLOUD = "https://yura-cloud.heiyeshi.workers.dev";
const YURA_LEVELS_CACHE_KEY = "yura-levels-native-last-good-v1";
let yuraLevelsHost = null;
let yuraLevelsPanel = null;
let yuraLevelsHiddenChildren = [];
let yuraLevelsEntries = [];
let yuraLevelsTimer = null;

function yuraLevelsEsc(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function yuraLevelsTotalExp(level) {
  const l = Math.max(1, Math.trunc(Number(level) || 1));
  if (l <= 1) return 0;
  return Math.max(0, Math.trunc((50 * (l*l*l - 6*l*l + 17*l - 12)) / 3));
}

function yuraLevelsLevelForExp(exp) {
  const value = Math.max(0, Math.trunc(Number(exp) || 0));
  let lo = 1, hi = 2;
  while (hi < 1000000 && yuraLevelsTotalExp(hi) <= value) {
    lo = hi;
    hi = Math.min(1000000, hi * 2);
    if (hi === lo) break;
  }
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (yuraLevelsTotalExp(mid) <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

function yuraLevelsProgress(exp) {
  const lvl = yuraLevelsLevelForExp(exp);
  const start = yuraLevelsTotalExp(lvl);
  const next = yuraLevelsTotalExp(lvl + 1);
  return {
    lvl,
    progress: Math.max(0, exp - start),
    target: Math.max(1, next - start)
  };
}

function yuraLevelsStamp(raw) {
  const d = new Date(raw || "");
  if (Number.isNaN(d.getTime())) return "â€”";
  return d.toLocaleString("pl-PL", {
    day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
  });
}

function yuraLevelsFindVisibleHeading() {
  return [...document.querySelectorAll("h1,h2")].find(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^(Komendy kanaĹ‚u|Ranking|O mnie|Harmonogram|Changelog)$/i.test(text);
  }) || null;
}

function yuraLevelsFindMainHost() {
  const heading = yuraLevelsFindVisibleHeading();
  if (!heading) return null;

  const hr = heading.getBoundingClientRect();
  let node = heading.parentElement;
  let best = null;

  // Walk only inside the same RIGHT content column. The previous implementation
  // used generic width/left thresholds and could miss the actual page host.
  while (node && node !== document.body && node !== document.documentElement) {
    const r = node.getBoundingClientRect();
    const sameRightColumn = r.left >= Math.max(250, hr.left - 130);
    const usefulWidth = r.width >= 620;
    const usefulHeight = r.height >= 260;

    if (sameRightColumn && usefulWidth && usefulHeight)
      best = node;

    // Once an ancestor jumps far left toward the profile/sidebar, stop.
    if (r.left < hr.left - 170)
      break;

    node = node.parentElement;
  }

  return best;
}

function yuraLevelsEnsureStyle() {
  if (document.getElementById("yura-levels-native-style")) return;

  const style = document.createElement("style");
  style.id = "yura-levels-native-style";
  style.textContent = `
    .yura-levels-native{width:100%;min-width:0;color:#f5f7fa}
    .yura-levels-native *{box-sizing:border-box}
    .yura-levels-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:0 0 22px}
    .yura-levels-eyebrow{font:900 10px Consolas,monospace;letter-spacing:.16em;color:#f28c18;margin-bottom:8px}
    .yura-levels-title{font-size:52px;line-height:.95;letter-spacing:-.045em;margin:0 0 8px}
    .yura-levels-subtitle{margin:0;color:#8d9aaa;font-size:15px;line-height:1.35}
    .yura-levels-live{flex:0 0 auto;border:1px solid rgba(72,214,148,.45);background:rgba(72,214,148,.08);color:#76e9b4;border-radius:999px;padding:8px 13px;font:10px Consolas,monospace;letter-spacing:.08em}
    .yura-levels-tabs{display:flex;gap:8px;border-bottom:1px solid #223141;margin-bottom:18px}
    .yura-levels-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:#8190a0;padding:12px 17px 11px;cursor:pointer;font:900 11px Consolas,monospace;letter-spacing:.08em}
    .yura-levels-tab.active{color:#fff;border-bottom-color:#f28c18}
    .yura-levels-toolbar{display:grid;grid-template-columns:1fr auto;gap:12px;border:1px solid #223141;border-radius:15px;padding:17px;margin-bottom:12px;background:rgba(12,19,27,.88)}
    .yura-levels-meta{display:flex;gap:38px;align-items:center}
    .yura-levels-metric small{display:block;color:#6f8092;font:9px Consolas,monospace;letter-spacing:.13em}
    .yura-levels-metric strong{display:block;margin-top:5px;font:12px Consolas,monospace;color:#f5f6f8}
    .yura-levels-status{color:#72e3ad!important}
    .yura-levels-search{width:290px;border:1px solid #31455b;background:#080e14;color:white;border-radius:10px;padding:10px 12px;outline:none}
    .yura-levels-search:focus{border-color:#6d4917}
    .yura-levels-podium{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-bottom:14px}
    .yura-levels-card{min-height:185px;border:1px solid #223141;border-radius:15px;padding:20px;background:linear-gradient(135deg,rgba(242,140,24,.06),#0b1118 55%);position:relative;overflow:hidden}
    .yura-levels-card:first-child{border-color:#9a5e0d;background:linear-gradient(135deg,rgba(242,140,24,.13),#0c1219 60%)}
    .yura-levels-card:after{position:absolute;right:20px;top:12px;font:72px Georgia,serif;color:rgba(242,140,24,.13)}
    .yura-levels-card:nth-child(1):after{content:"I"}.yura-levels-card:nth-child(2):after{content:"II"}.yura-levels-card:nth-child(3):after{content:"III"}
    .yura-levels-ranktag{font:900 9px Consolas,monospace;color:#f28c18;letter-spacing:.12em}
    .yura-levels-name{font-size:27px;font-weight:850;margin-top:43px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .yura-levels-level{font:900 22px Consolas,monospace;margin-top:8px}
    .yura-levels-exp{font:9px Consolas,monospace;color:#6f8294;letter-spacing:.1em;margin-top:5px}
    .yura-levels-table{border:1px solid #223141;border-radius:15px;overflow:hidden;background:#091017}
    .yura-levels-head,.yura-levels-row{display:grid;grid-template-columns:90px minmax(180px,1.4fr) 150px 180px;align-items:center;gap:12px;padding:0 18px}
    .yura-levels-head{height:38px;border-bottom:1px solid #223141;font:9px Consolas,monospace;color:#65788a;letter-spacing:.12em}
    .yura-levels-row{min-height:61px;border-bottom:1px solid rgba(255,255,255,.045);font-size:14px}
    .yura-levels-row:last-child{border-bottom:0}
    .yura-levels-pos{font:900 11px Consolas,monospace;color:#f28c18}
    .yura-levels-user{font-weight:800}
    .yura-levels-pill{justify-self:start;border:1px solid #37485a;border-radius:999px;padding:5px 9px;font:900 10px Consolas,monospace;color:#a9d1ff}
    .yura-levels-expval{justify-self:end;font:900 12px Consolas,monospace}
    .yura-levels-progress{height:4px;border-radius:99px;background:#182330;margin-top:7px;overflow:hidden}
    .yura-levels-progress i{display:block;height:100%;background:linear-gradient(90deg,#f28c18,#3b9cff);border-radius:99px}
    .yura-levels-empty{padding:36px;text-align:center;color:#788898}
    .yura-levels-expgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}
    .yura-levels-calc{border:1px solid #223141;border-radius:14px;background:#0b1219;padding:16px}
    .yura-levels-calc h3{margin:0 0 12px;font-size:14px}
    .yura-levels-calcline{display:grid;grid-template-columns:1fr auto;gap:8px}
    .yura-levels-calc input{background:#070d13;color:#fff;border:1px solid #31455b;border-radius:9px;padding:10px}
    .yura-levels-calc button{background:#142335;color:#fff;border:1px solid #36526f;border-radius:9px;padding:9px 12px;cursor:pointer}
    .yura-levels-calcresult{font:11px Consolas,monospace;color:#9fb2c6;margin-top:10px;min-height:16px}
    .yura-levels-note{color:#778797;font-size:12px;margin:0 0 12px}
    .yura-levels-hidden{display:none!important}
    @media(max-width:1050px){.yura-levels-podium{grid-template-columns:1fr}.yura-levels-toolbar{grid-template-columns:1fr}.yura-levels-search{width:100%}}
  `;
  document.head.appendChild(style);
}

function yuraLevelsSetNavActive(active) {
  const levels = document.querySelector("[data-yura-levels-nav='1']");
  if (!levels) return;
  const navItems = [...document.querySelectorAll("a,button,[data-view]")];
  if (active) {
    navItems.forEach(el => {
      if (el === levels) return;
      el.classList.remove("active","is-active","selected");
      el.removeAttribute("aria-current");
    });
    levels.classList.add("active");
    levels.setAttribute("aria-current","page");
  } else {
    levels.classList.remove("active","is-active","selected");
    levels.removeAttribute("aria-current");
  }
}

function yuraLevelsMarkup() {
  return `
    <section class="yura-levels-native">
      <div class="yura-levels-hero">
        <div>
          <div class="yura-levels-eyebrow">Y.U.R.A. LEVEL NETWORK</div>
          <h1 class="yura-levels-title">Levels</h1>
          <p class="yura-levels-subtitle">Publiczny ranking poziomĂłw Y.U.R.A. oraz tabela doĹ›wiadczenia oparta 1:1 o klasycznÄ… krzywÄ… Tibii.</p>
        </div>
        <div class="yura-levels-live">LIVE DATA</div>
      </div>

      <div class="yura-levels-tabs">
        <button class="yura-levels-tab active" data-yura-levels-tab="ranking">RANKING</button>
        <button class="yura-levels-tab" data-yura-levels-tab="table">EXP TABLE</button>
      </div>

      <div data-yura-levels-view="ranking">
        <div class="yura-levels-toolbar">
          <div class="yura-levels-meta">
            <div class="yura-levels-metric"><small>EXP SYNC</small><strong>5 MIN</strong></div>
            <div class="yura-levels-metric"><small>LAST SYNC</small><strong data-yura-levels-last>â€”</strong></div>
            <div class="yura-levels-metric"><small>STATUS</small><strong class="yura-levels-status" data-yura-levels-status>ĹADOWANIE</strong></div>
          </div>
          <input class="yura-levels-search" data-yura-levels-search placeholder="âŚ• Szukaj siebie na liĹ›cieâ€¦">
        </div>
        <div class="yura-levels-podium" data-yura-levels-podium></div>
        <div class="yura-levels-table">
          <div class="yura-levels-head"><div>POZYCJA</div><div>UĹ»YTKOWNIK</div><div>LEVEL</div><div style="text-align:right">TOTAL EXP</div></div>
          <div data-yura-levels-rows></div>
        </div>
      </div>

      <div class="yura-levels-hidden" data-yura-levels-view="table">
        <div class="yura-levels-expgrid">
          <div class="yura-levels-calc">
            <h3>EXP â†’ LEVEL</h3>
            <div class="yura-levels-calcline"><input data-yura-exp-input type="number" min="0" value="9300"><button data-yura-exp-calc>OBLICZ</button></div>
            <div class="yura-levels-calcresult" data-yura-exp-result></div>
          </div>
          <div class="yura-levels-calc">
            <h3>LEVEL â†’ TOTAL EXP</h3>
            <div class="yura-levels-calcline"><input data-yura-level-input type="number" min="1" max="100" value="50"><button data-yura-level-calc>OBLICZ</button></div>
            <div class="yura-levels-calcresult" data-yura-level-result></div>
          </div>
        </div>
        <p class="yura-levels-note">Tabela LVL 1â€“100 jest generowana z tej samej formuĹ‚y co YURA Desktop i YURA Cloud.</p>
        <div class="yura-levels-table">
          <div class="yura-levels-head"><div>LEVEL</div><div>TOTAL EXP</div><div>OD POPRZEDNIEGO</div><div style="text-align:right">DO NASTÄPNEGO</div></div>
          <div data-yura-exp-rows></div>
        </div>
      </div>
    </section>`;
}

function yuraLevelsNormalizeEntry(x) {
  const exp = Math.max(0, Number(x?.exp || 0) || 0);
  const p = yuraLevelsProgress(exp);
  return {
    login:String(x?.login || ""),
    name:String(x?.name || x?.login || "â€”"),
    exp,
    level:Number(x?.level || p.lvl) || p.lvl,
    progress:Number(x?.progress ?? p.progress),
    target:Number(x?.target ?? p.target)
  };
}

function yuraLevelsRenderRanking() {
  if (!yuraLevelsPanel) return;
  const nf = new Intl.NumberFormat("pl-PL");
  const input = yuraLevelsPanel.querySelector("[data-yura-levels-search]");
  const q = String(input?.value || "").trim().toLowerCase();
  const filtered = yuraLevelsEntries.filter(x => !q || x.name.toLowerCase().includes(q) || x.login.toLowerCase().includes(q));

  const podium = yuraLevelsPanel.querySelector("[data-yura-levels-podium]");
  podium.innerHTML = yuraLevelsEntries.slice(0,3).map((x,i) => `
    <article class="yura-levels-card">
      <div class="yura-levels-ranktag">RANK ${String(i+1).padStart(2,"0")}</div>
      <div class="yura-levels-name">${yuraLevelsEsc(x.name)}</div>
      <div class="yura-levels-level">LVL ${nf.format(x.level)}</div>
      <div class="yura-levels-exp">${nf.format(x.exp)} YURA EXP</div>
    </article>`).join("");

  const rows = yuraLevelsPanel.querySelector("[data-yura-levels-rows]");
  if (!filtered.length) {
    rows.innerHTML = `<div class="yura-levels-empty">Brak wynikĂłw.</div>`;
    return;
  }

  rows.innerHTML = filtered.map(x => {
    const realPos = yuraLevelsEntries.indexOf(x) + 1;
    const pct = Math.max(0, Math.min(100, (x.progress / Math.max(1,x.target)) * 100));
    return `
      <div class="yura-levels-row">
        <div class="yura-levels-pos">${String(realPos).padStart(2,"0")}</div>
        <div><div class="yura-levels-user">${yuraLevelsEsc(x.name)}</div><div class="yura-levels-progress"><i style="width:${pct.toFixed(2)}%"></i></div></div>
        <div><span class="yura-levels-pill">LVL ${nf.format(x.level)}</span></div>
        <div class="yura-levels-expval">${nf.format(x.exp)}</div>
      </div>`;
  }).join("");
}

function yuraLevelsRenderExpTable() {
  if (!yuraLevelsPanel) return;
  const nf = new Intl.NumberFormat("pl-PL");
  let html = "";
  for (let lvl=1; lvl<=100; lvl++) {
    const total = yuraLevelsTotalExp(lvl);
    const prev = lvl <= 1 ? 0 : total - yuraLevelsTotalExp(lvl-1);
    const next = yuraLevelsTotalExp(lvl+1) - total;
    html += `
      <div class="yura-levels-row">
        <div class="yura-levels-pos">${lvl}</div>
        <div class="yura-levels-user">${nf.format(total)} EXP</div>
        <div><span class="yura-levels-pill">${lvl===1 ? "â€”" : nf.format(prev)}</span></div>
        <div class="yura-levels-expval">${nf.format(next)}</div>
      </div>`;
  }
  yuraLevelsPanel.querySelector("[data-yura-exp-rows]").innerHTML = html;
}

async function yuraLevelsLoad(force=false) {
  if (!yuraLevelsPanel) return;
  if (document.hidden && !force) return;

  const status = yuraLevelsPanel.querySelector("[data-yura-levels-status]");
  const last = yuraLevelsPanel.querySelector("[data-yura-levels-last]");

  try {
    const r = await fetch(`${YURA_LEVELS_CLOUD}/api/levels?_=${Date.now()}`, { cache:"no-store" });
    if (!r.ok) throw new Error(`levels ${r.status}`);
    const data = await r.json();

    yuraLevelsEntries = (Array.isArray(data?.entries) ? data.entries : [])
      .map(yuraLevelsNormalizeEntry)
      .sort((a,b) => b.exp-a.exp || a.name.localeCompare(b.name));

    localStorage.setItem(YURA_LEVELS_CACHE_KEY, JSON.stringify(data));
    last.textContent = yuraLevelsStamp(data?.generated_at_utc || data?.updatedAt || new Date().toISOString());
    status.textContent = "LIVE DATA";
    yuraLevelsRenderRanking();
  } catch (err) {
    try {
      const cached = JSON.parse(localStorage.getItem(YURA_LEVELS_CACHE_KEY) || "null");
      if (cached && Array.isArray(cached.entries)) {
        yuraLevelsEntries = cached.entries.map(yuraLevelsNormalizeEntry).sort((a,b)=>b.exp-a.exp || a.name.localeCompare(b.name));
        last.textContent = yuraLevelsStamp(cached?.generated_at_utc || cached?.updatedAt);
        status.textContent = "LAST GOOD DATA";
        yuraLevelsRenderRanking();
        return;
      }
    } catch {}
    status.textContent = "SYNC ERROR";
    console.error(err);
  }
}

function yuraLevelsWire() {
  if (!yuraLevelsPanel) return;

  yuraLevelsPanel.querySelectorAll("[data-yura-levels-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-yura-levels-tab");
      yuraLevelsPanel.querySelectorAll("[data-yura-levels-tab]").forEach(x => x.classList.toggle("active", x===btn));
      yuraLevelsPanel.querySelectorAll("[data-yura-levels-view]").forEach(view => {
        view.classList.toggle("yura-levels-hidden", view.getAttribute("data-yura-levels-view") !== target);
      });
    });
  });

  yuraLevelsPanel.querySelector("[data-yura-levels-search]")?.addEventListener("input", yuraLevelsRenderRanking);

  yuraLevelsPanel.querySelector("[data-yura-exp-calc]")?.addEventListener("click", () => {
    const nf = new Intl.NumberFormat("pl-PL");
    const input = yuraLevelsPanel.querySelector("[data-yura-exp-input]");
    const exp = Math.max(0, Math.trunc(Number(input?.value) || 0));
    const p = yuraLevelsProgress(exp);
    yuraLevelsPanel.querySelector("[data-yura-exp-result]").textContent =
      `LVL ${p.lvl} â€˘ ${nf.format(p.progress)} / ${nf.format(p.target)} EXP`;
  });

  yuraLevelsPanel.querySelector("[data-yura-level-calc]")?.addEventListener("click", () => {
    const nf = new Intl.NumberFormat("pl-PL");
    const input = yuraLevelsPanel.querySelector("[data-yura-level-input]");
    const lvl = Math.max(1, Math.min(100, Math.trunc(Number(input?.value) || 1)));
    input.value = String(lvl);
    yuraLevelsPanel.querySelector("[data-yura-level-result]").textContent =
      `LVL ${lvl} wymaga ${nf.format(yuraLevelsTotalExp(lvl))} Ĺ‚Ä…cznego EXP`;
  });

  yuraLevelsRenderExpTable();
}

function yuraShowLevelsView(pushHistory=true) {
  const host = yuraLevelsFindMainHost();

  // Never navigate to standalone Levels from the sidebar anymore.
  // If host discovery fails, leave the current page intact and retry shortly.
  if (!host) {
    window.setTimeout(() => yuraShowLevelsView(pushHistory), 120);
    return;
  }

  yuraLevelsEnsureStyle();
  yuraLevelsHost = host;

  if (!yuraLevelsPanel) {
    yuraLevelsHiddenChildren = [...host.children].map(el => ({el, display:el.style.display}));
    yuraLevelsHiddenChildren.forEach(x => x.el.style.display = "none");

    const panel = document.createElement("div");
    panel.id = "yura-levels-native-view";
    panel.innerHTML = yuraLevelsMarkup();
    host.appendChild(panel);
    yuraLevelsPanel = panel;

    yuraLevelsWire();
    yuraLevelsLoad(true);
    yuraLevelsTimer = window.setInterval(() => yuraLevelsLoad(false), 5*60*1000);
  }

  yuraLevelsSetNavActive(true);

  if (pushHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set("yuraView","levels");
    history.pushState({yuraView:"levels"},"",url);
  }
}

function yuraHideLevelsView(updateHistory=true) {
  if (yuraLevelsTimer) {
    window.clearInterval(yuraLevelsTimer);
    yuraLevelsTimer = null;
  }

  if (yuraLevelsPanel) {
    yuraLevelsPanel.remove();
    yuraLevelsPanel = null;
  }

  yuraLevelsHiddenChildren.forEach(x => {
    if (x?.el) x.el.style.display = x.display || "";
  });

  yuraLevelsHiddenChildren = [];
  yuraLevelsHost = null;
  yuraLevelsSetNavActive(false);

  if (updateHistory) {
    const url = new URL(window.location.href);
    url.searchParams.delete("yuraView");
    history.replaceState({}, "", url);
  }
}

function yuraInstallLevelsNavLink() {
  const old = document.querySelector("[data-yura-levels-nav='1']");
  if (old) {
    // Replace stale historical clones/handlers instead of trusting them.
    old.remove();
  }

  const candidates = [...document.querySelectorAll("a,button,[data-view]")];
  const ranking = candidates.find(el => {
    const text = String(el.textContent || "").replace(/\s+/g," ").trim();
    return /^Ranking\b/i.test(text) || /\bRanking\s+TOP\s*10\b/i.test(text);
  });
  if (!ranking) return false;

  const clone = ranking.cloneNode(true);
  clone.setAttribute("data-yura-levels-nav","1");
  clone.removeAttribute("data-view");
  clone.removeAttribute("href");
  clone.removeAttribute("aria-current");
  clone.classList.remove("active","is-active","selected");

  clone.innerHTML = clone.innerHTML
    .replace(/Ranking/g,"Levels")
    .replace(/TOP\s*10/gi,"EXP");

  clone.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    yuraShowLevelsView(true);
  }, true);

  ranking.insertAdjacentElement("afterend", clone);
  return true;
}

document.addEventListener("click", event => {
  if (!yuraLevelsPanel) return;
  const item = event.target?.closest?.("a,button,[data-view]");
  if (!item || item.matches("[data-yura-levels-nav='1']")) return;
  const text = String(item.textContent || "").replace(/\s+/g," ").trim();
  if (/^(Komendy|Ranking|O mnie|Harmonogram|Changelog)\b/i.test(text))
    yuraHideLevelsView(true);
}, true);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && yuraLevelsPanel) yuraLevelsLoad(true);
});

window.addEventListener("popstate", () => {
  const wants = new URL(window.location.href).searchParams.get("yuraView") === "levels";
  if (wants) yuraShowLevelsView(false);
  else yuraHideLevelsView(false);
});

function yuraBootLevelsNative() {
  if (!yuraInstallLevelsNavLink()) {
    const observer = new MutationObserver(() => {
      if (yuraInstallLevelsNavLink()) {
        observer.disconnect();
        if (new URL(window.location.href).searchParams.get("yuraView") === "levels")
          window.setTimeout(() => yuraShowLevelsView(false), 50);
      }
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    window.setTimeout(() => observer.disconnect(),15000);
  } else if (new URL(window.location.href).searchParams.get("yuraView") === "levels") {
    window.setTimeout(() => yuraShowLevelsView(false), 50);
  }
}

yuraBootLevelsNative();
