/* Y.U.R.A. public Pokémon hub — read-only Pokédex and Pokémon Trainers. */
(() => {
  'use strict';
  const root = document.getElementById('pokemonView');
  if (!root) return;
  const cloud = 'https://yura-cloud.heiyeshi.workers.dev';
  const art = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const tabs = [...root.querySelectorAll('[data-pokemon-mode]')];
  const search = root.querySelector('#pokemonSearch');
  const dexPanel = root.querySelector('#pokemonDexPanel');
  const trainersPanel = root.querySelector('#pokemonTrainersPanel');
  const dexGrid = root.querySelector('#pokemonDexGrid');
  const trainersGrid = root.querySelector('#pokemonTrainersGrid');
  const dexCount = root.querySelector('#pokemonDexCount');
  const trainersResultCount = root.querySelector('#pokemonTrainersResultCount');
  const speciesTotal = root.querySelector('#pokemonSpeciesCount');
  const trainersTotal = root.querySelector('#pokemonTrainersCount');
  const dexMore = root.querySelector('#pokemonDexMore');
  const trainersMore = root.querySelector('#pokemonTrainersMore');
  const status = root.querySelector('#pokemonStatus');
  const nf = new Intl.NumberFormat('pl-PL');
  const batchSize = 24;
  const avatarCache = new Map();
  const avatarPending = new Set();
  let entries = [], species = [], loadedAt = 0, inflight = null;
  let mode = 'dex', shownDex = 0, shownTrainers = 0;
  const norm = x => String(x ?? '').trim().toLocaleLowerCase('pl-PL');
  const fmt = n => nf.format(n);
  const make = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    return el;
  };
  const visible = () => !root.hidden;
  const errorMessage = (target, main, detail = '') => {
    const el = make('div', 'pokemon-empty', main);
    if (detail) el.append(make('p', '', detail));
    target.replaceChildren(el);
  };
  const safeAvatar = raw => {
    if (!raw || typeof raw !== 'string') return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !/(^|\.)(jtvnw\.net|twitchcdn\.net)$/.test(url.hostname.toLowerCase())) return '';
      return url.href;
    } catch { return ''; }
  };
  const artwork = item => {
    const picture = make('div', 'pokemon-artwork');
    const img = document.createElement('img');
    img.alt = item.pokemonName || 'Pokémon #' + item.pokemonId;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 110;
    img.height = 110;
    img.src = art + 'other/official-artwork/' + item.pokemonId + '.png';
    img.onerror = () => {
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = art + item.pokemonId + '.png';
    };
    picture.append(img);
    return picture;
  };
  const query = () => norm(search.value).replace(/^@/, '');
  const matches = (item, term) => !term ||
    norm(item.pokemonName).includes(term) ||
    String(item.pokemonId).includes(term) ||
    norm(item.login).includes(term) ||
    norm(item.name).includes(term);

  async function load() {
    if (loadedAt && Date.now() - loadedAt < 5 * 60 * 1000) return;
    if (inflight) return inflight;
    status.textContent = 'POBIERANIE DANYCH';
    inflight = (async () => {
      const resp = await fetch(cloud + '/api/pokemon/collection', { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const payload = await resp.json();
      if (!Array.isArray(payload?.entries)) throw new Error('Niepoprawny format odpowiedzi Y.U.R.A. Cloud');
      const used = new Set();
      const next = [];
      for (const row of payload.entries) {
        const login = norm(row?.login);
        const id = Number(row?.pokemonId);
        if (!/^[a-z0-9_]{2,25}$/.test(login) ||
            !Number.isInteger(id) || id < 1 || id > 1025 || used.has(login)) continue;
        used.add(login);
        next.push({
          login,
          name: String(row?.name || login).trim().slice(0, 64) || login,
          pokemonId: id,
          pokemonName: String(row?.pokemonName || '').trim().slice(0, 80)
        });
      }
      if (next.some(row => !row.pokemonName)) {
        try {
          const dexResp = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025', { cache: 'force-cache' });
          if (dexResp.ok) {
            const dexData = await dexResp.json();
            const names = new Map((dexData.results || []).map(item => {
              const id = String(item.url || '').match(/\/pokemon\/(\d+)\/?$/);
              return [id ? Number(id[1]) : 0, String(item.name || '')];
            }));
            next.forEach(row => {
              if (row.pokemonName || !names.has(row.pokemonId)) return;
              const name = names.get(row.pokemonId).replace(/-/g, ' ');
              row.pokemonName = name[0].toUpperCase() + name.slice(1);
            });
          }
        } catch { /* Species IDs still remain available. */ }
      }
      next.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
      const grouped = new Map();
      for (const row of next) {
        if (!grouped.has(row.pokemonId)) grouped.set(row.pokemonId, {
          pokemonId: row.pokemonId, pokemonName: row.pokemonName,
          trainers: []
        });
        const item = grouped.get(row.pokemonId);
        if (!item.pokemonName && row.pokemonName) item.pokemonName = row.pokemonName;
        item.trainers.push({ login: row.login, name: row.name });
      }
      entries = next;
      species = [...grouped.values()].sort((a, b) => a.pokemonId - b.pokemonId);
      loadedAt = Date.now();
      speciesTotal.textContent = fmt(species.length);
      trainersTotal.textContent = fmt(entries.length);
      status.textContent = 'Y.U.R.A. CLOUD / ONLINE';
    })().catch(err => {
      status.textContent = 'BRAK DANYCH CLOUD';
      loadedAt = 0;
      throw err;
    }).finally(() => { inflight = null; });
    return inflight;
  }

  const dexCard = item => {
    const card = make('article', 'pokemon-dex-card');
    card.append(artwork(item));
    const info = make('div', 'pokemon-dex-info');
    info.append(
      make('span', 'pokemon-number', '#' + String(item.pokemonId).padStart(4, '0')),
      make('strong', 'pokemon-species', item.pokemonName || 'Pokémon #' + item.pokemonId),
      make('span', 'pokemon-dex-trainers', fmt(item.trainers.length) +
        (item.trainers.length === 1 ? ' trener' : ' trenerów'))
    );
    const names = make('p', 'pokemon-dex-owners',
      item.trainers.slice(0, 3).map(person => '@' + person.name).join(', ') +
      (item.trainers.length > 3 ? ' +' + (item.trainers.length - 3) : ''));
    info.append(names);
    card.append(info);
    return card;
  };

  const trainerCard = item => {
    const card = make('article', 'pokemon-trainer-card');
    const user = make('div', 'pokemon-trainer-user');
    const avatar = make('div', 'pokemon-trainer-avatar', item.name.charAt(0).toUpperCase());
    avatar.dataset.trainerAvatar = item.login;
    const who = make('div', 'pokemon-trainer-person');
    who.append(make('strong', '', item.name), make('span', '', '@' + item.login));
    user.append(avatar, who);
    const assigned = make('div', 'pokemon-trainer-assigned');
    assigned.append(artwork(item));
    const data = make('div', 'pokemon-trainer-pokemon');
    data.append(
      make('span', 'pokemon-number', '#' + String(item.pokemonId).padStart(4, '0')),
      make('strong', '', item.pokemonName || 'Pokémon #' + item.pokemonId)
    );
    assigned.append(data);
    card.append(user, assigned);
    return card;
  };

  function updateAvatars() {
    root.querySelectorAll('[data-trainer-avatar]').forEach(el => {
      const url = safeAvatar(avatarCache.get(el.dataset.trainerAvatar));
      if (!url || el.querySelector('img')) return;
      const img = document.createElement('img');
      img.src = url;
      img.loading = 'lazy';
      img.alt = '';
      img.onerror = () => img.remove();
      el.append(img);
    });
  }

  async function fetchAvatars(logins) {
    const unique = [...new Set(logins)].filter(login => !avatarCache.has(login) && !avatarPending.has(login));
    for (let i = 0; i < unique.length; i += 20) {
      const group = unique.slice(i, i + 20);
      group.forEach(login => avatarPending.add(login));
      try {
        const r = await fetch(cloud + '/api/avatars?logins=' + encodeURIComponent(group.join(',')),
          { cache: 'default' });
        if (!r.ok) throw new Error('Avatar lookup unavailable');
        const data = await r.json();
        group.forEach(login => avatarCache.set(login, safeAvatar(data?.avatars?.[login])));
        if (visible() && mode === 'trainers') updateAvatars();
      } catch {
        group.forEach(login => avatarCache.set(login, ''));
      } finally { group.forEach(login => avatarPending.delete(login)); }
    }
  }

  function renderDex(more = false) {
    const term = query();
    const results = species.filter(item => matches(item, term) ||
      item.trainers.some(person => norm(person.name).includes(term) || norm(person.login).includes(term)));
    if (!more) { shownDex = 0; dexGrid.replaceChildren(); }
    dexCount.textContent = fmt(results.length) + (results.length === 1 ? ' GATUNEK' : ' GATUNKÓW');
    if (!results.length) {
      errorMessage(dexGrid, term ? 'Nie znaleziono Pokémona.' : 'Pokédex jest jeszcze pusty.',
        term ? 'Spróbuj innej nazwy lub numeru.' : 'Pokémony pojawią się po przypisaniu ich widzom.');
      dexMore.hidden = true;
      return;
    }
    const next = results.slice(shownDex, shownDex + batchSize);
    dexGrid.append(...next.map(dexCard));
    shownDex += next.length;
    dexMore.hidden = shownDex >= results.length;
    dexMore.textContent = 'Pokaż kolejne (' + fmt(Math.min(batchSize, results.length - shownDex)) + ')';
  }

  function renderTrainers(more = false) {
    const results = entries.filter(item => matches(item, query()));
    if (!more) { shownTrainers = 0; trainersGrid.replaceChildren(); }
    trainersResultCount.textContent = fmt(results.length) +
      (results.length === 1 ? ' TRENER' : ' TRENERÓW');
    if (!results.length) {
      errorMessage(trainersGrid, query() ? 'Nie znaleziono trenera.' : 'Nie ma jeszcze trenerów.',
        'Przypisania pojawią się po użyciu komendy !pokemon.');
      trainersMore.hidden = true;
      return;
    }
    const next = results.slice(shownTrainers, shownTrainers + batchSize);
    trainersGrid.append(...next.map(trainerCard));
    shownTrainers += next.length;
    trainersMore.hidden = shownTrainers >= results.length;
    trainersMore.textContent = 'Pokaż kolejnych (' +
      fmt(Math.min(batchSize, results.length - shownTrainers)) + ')';
    updateAvatars();
    void fetchAvatars(next.map(person => person.login));
  }

  function render() {
    if (!loadedAt) return;
    if (mode === 'dex') renderDex();
    else renderTrainers();
  }
  function setMode(next) {
    if (next !== 'dex' && next !== 'trainers') return;
    mode = next;
    tabs.forEach(tab => {
      const active = tab.dataset.pokemonMode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    dexPanel.hidden = mode !== 'dex';
    trainersPanel.hidden = mode !== 'trainers';
    search.placeholder = mode === 'dex' ? 'Szukaj Pokémona lub numeru…' :
      'Szukaj trenera lub Pokémona…';
    search.value = '';
    render();
  }
  tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.pokemonMode)));
  root.querySelector('.pokemon-tabs').addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = mode === 'dex' ? 'trainers' : 'dex';
    setMode(next);
    tabs.find(tab => tab.dataset.pokemonMode === next)?.focus();
  });
  search.addEventListener('input', render);
  dexMore.addEventListener('click', () => renderDex(true));
  trainersMore.addEventListener('click', () => renderTrainers(true));

  async function open() {
    if (!visible()) return;
    if (!loadedAt) {
      errorMessage(dexGrid, 'Ładowanie Pokédexu…');
      errorMessage(trainersGrid, 'Ładowanie listy trenerów…');
    }
    try {
      await load();
      if (visible()) render();
    } catch {
      errorMessage(dexGrid, 'Nie można teraz pobrać Pokédexu.',
        'Y.U.R.A. Cloud nie udostępnia chwilowo danych. Spróbuj ponownie później.');
      errorMessage(trainersGrid, 'Nie można teraz pobrać trenerów.',
        'Y.U.R.A. Cloud nie udostępnia chwilowo danych. Spróbuj ponownie później.');
      dexMore.hidden = trainersMore.hidden = true;
    }
  }
  document.addEventListener('yura:pokemon-open', open);
  if (visible()) void open();
})();