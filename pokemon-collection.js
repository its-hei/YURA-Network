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
  const dexSummary = root.querySelector('#pokemonDexSummary');
  const trainersSummary = root.querySelector('#pokemonTrainersSummary');
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
  const generation = id => {
    const n = Number(id);
    const ends = [151,251,386,493,649,721,809,905,1025];
    const regions = ['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar / Hisui','Paldea'];
    const roman = ['I','II','III','IV','V','VI','VII','VIII','IX'];
    const idx = ends.findIndex(end => n >= 1 && n <= end);
    return idx < 0 ? {num:0,label:'GEN ?',region:'—'} :
      {num:idx + 1,label:'GEN ' + roman[idx],region:regions[idx]};
  };
  const formatDate = value => {
    const when = new Date(value || '');
    return Number.isFinite(when.getTime()) ? when.toLocaleDateString('pl-PL') : '';
  };
  const historyEvent = raw => {
    const id = Number(raw?.pokemonId);
    if (!Number.isInteger(id) || id < 1 || id > 1025) return null;
    return {
      pokemonId:id, pokemonName:String(raw?.pokemonName || '').slice(0,80),
      at:String(raw?.at || '').slice(0,40),
      type:String(raw?.type || '').slice(0,20),
      approximate:raw?.approximate === true
    };
  };
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
          pokemonName: String(row?.pokemonName || '').trim().slice(0, 80),
          joinOrder: Number.isInteger(Number(row?.joinOrder)) && Number(row?.joinOrder) > 0 ? Number(row.joinOrder) : null,
          joinedAt: String(row?.joinedAt || '').slice(0,40),
          joinEstimated: row?.joinEstimated === true,
          history: Array.isArray(row?.history) ? row.history.map(historyEvent).filter(Boolean) : []
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
      next.sort((a, b) => a.pokemonId - b.pokemonId || a.name.localeCompare(b.name, 'pl'));
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
    const head = make('div', 'pokemon-dex-card-head');
    const gen = generation(item.pokemonId);
    const genChip = make('span', 'pokemon-gen', gen.label);
    genChip.title = gen.region;
    head.append(make('span', 'pokemon-number', '#' + String(item.pokemonId).padStart(4, '0')), genChip);
    const body = make('div', 'pokemon-dex-card-body');
    const portrait = make('div', 'pokemon-dex-portrait');
    portrait.append(artwork(item));
    portrait.append(make('span', 'pokemon-dex-trainers', fmt(item.trainers.length) +
      (item.trainers.length === 1 ? ' trener' : ' trenerów')));
    const info = make('div', 'pokemon-dex-info');
    info.append(make('strong', 'pokemon-species', item.pokemonName || 'Pokémon #' + item.pokemonId));
    info.append(make('p', 'pokemon-dex-owners',
      item.trainers.slice(0, 2).map(person => '@' + person.name).join(', ') +
      (item.trainers.length > 2 ? ' +' + (item.trainers.length - 2) : '')));
    body.append(portrait, info);
    card.append(head, body);
    return card;
  };

  const trainerHistory = item => {
    const block = make('section', 'pokemon-trainer-history');
    const title = make('div', 'pokemon-trainer-history-head');
    title.append(make('span', '', 'HISTORIA POKÉMONÓW'));
    title.append(make('span', '', fmt(item.history.length) + (item.history.length === 1 ? ' LOSOWANIE' : ' LOSOWAŃ')));
    block.append(title);
    const list = make('div', 'pokemon-trainer-history-list');
    const records = [...item.history].reverse(); // newest first, retain repeated draws
    const createChip = (record, idx) => {
      const chip = make('span', 'pokemon-trainer-history-chip' +
        (record.pokemonId === item.pokemonId && idx === 0 ? ' current' : ''));
      chip.append(
        make('small', '', '#' + String(record.pokemonId).padStart(4,'0')),
        make('span', '', record.pokemonName || 'Pokémon #' + record.pokemonId),
        make('small', '', generation(record.pokemonId).label)
      );
      const at = formatDate(record.at);
      chip.title = [at, generation(record.pokemonId).region,
        record.type === 'first' ? 'Pierwsze przypisanie' :
        record.type === 'purchase' ? 'Starsze płatne losowanie' : 'Ponowne losowanie',
        record.approximate ? 'Dane historyczne (niepełne)' : ''].filter(Boolean).join(' · ');
      return chip;
    };
    if (records.length) {
      const visible = records.slice(0,4);
      list.append(...visible.map(createChip));
      if (records.length > visible.length) {
        const btn = make('button', 'pokemon-history-more',
          'Pokaż całą historię (+' + fmt(records.length - visible.length) + ')');
        btn.type = 'button';
        btn.setAttribute('aria-expanded','false');
        btn.addEventListener('click', () => {
          const expanded = btn.getAttribute('aria-expanded') === 'true';
          list.replaceChildren(...(expanded ? visible : records).map(createChip));
          btn.setAttribute('aria-expanded',String(!expanded));
          btn.textContent = expanded ? 'Pokaż mniej' : 'Zwiń historię';
        });
        block.append(list,btn);
      } else block.append(list);
    } else {
      block.append(make('div', 'pokemon-trainer-history-note', 'Brak zapisanych losowań.'));
    }
    if (item.joinEstimated)
      block.append(make('small','pokemon-trainer-history-note',
        'Starsze daty i pierwsze losowania mogą być niepełne.'));
    return block;
  };

  const trainerCard = item => {
    const card = make('article', 'pokemon-trainer-card');
    const user = make('div', 'pokemon-trainer-user');
    const avatar = make('div', 'pokemon-trainer-avatar', item.name.charAt(0).toUpperCase());
    avatar.dataset.trainerAvatar = item.login;
    const who = make('div', 'pokemon-trainer-person');
    who.append(make('strong', '', item.name), make('span', '', '@' + item.login));
    if (item.joinOrder) {
      const join = make('span', 'pokemon-trainer-join',
        'TRENER #' + fmt(item.joinOrder) + (item.joinEstimated ? '*' : ''));
      const date = formatDate(item.joinedAt);
      join.title = item.joinEstimated
        ? 'Kolejność oszacowana na podstawie zachowanych danych' + (date ? ' · ' + date : '')
        : 'Dołączył ' + (date || 'do kolekcji');
      who.append(join);
    }
    const gen = generation(item.pokemonId);
    const genChip = make('span', 'pokemon-gen', gen.label);
    genChip.title = gen.region;
    user.append(avatar, who, genChip);
    const assigned = make('div', 'pokemon-trainer-assigned');
    assigned.append(artwork(item));
    const data = make('div', 'pokemon-trainer-pokemon');
    data.append(
      make('span', 'pokemon-number', '#' + String(item.pokemonId).padStart(4, '0')),
      make('strong', '', item.pokemonName || 'Pokémon #' + item.pokemonId)
    );
    assigned.append(data);
    card.append(user, assigned, trainerHistory(item));
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
    const term = query();
    const results = entries.filter(item => matches(item, term) ||
      item.history.some(record => norm(record.pokemonName).includes(term) ||
        String(record.pokemonId).includes(term)));
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
    dexSummary.hidden = mode !== 'dex';
    trainersSummary.hidden = mode !== 'trainers';
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