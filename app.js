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

const YURA_CLOUD_BASE = "https://yura-cloud.heiyeshi.workers.dev";
const LEADERBOARD_POLL_MS = 5 * 60 * 1000;
let leaderboardRevision = "";
let leaderboardMetadataLoaded = false;
let leaderboardMetadataByName = new Map();

async function loadLeaderboardMetadata() {
  if (leaderboardMetadataLoaded) return;
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/its-hei/YURA-Network/live-data/leaderboard.json?t=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) return;
    const data = await response.json();
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
    leaderboardRevision = String(data?.revision || revision || "");
    renderLeaderboard(data);
  } catch (error) {
    leaderboardStatus.textContent = "SYNC ERROR";
    leaderboardStatus.classList.remove("is-live");
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
