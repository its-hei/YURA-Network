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
  let entries = [], species = [], loadedAt = 0, inflight = null;
  let mode = 'dex', shownDex = 0, shownTrainers = 0;
  const norm = x => String(x ?? '').trim().toLocaleLowerCase('pl-PL');
  const fmt = n => nf.format(n);
  const formatPokemonName = raw => String(raw ?? '').trim().replace(/-/g, ' ')
    .replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toLocaleUpperCase('pl-PL'));
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
      pokemonId:id, pokemonName:formatPokemonName(String(raw?.pokemonName || '').slice(0,80)),
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
          pokemonName: formatPokemonName(String(row?.pokemonName || '').trim().slice(0, 80)),
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
              row.pokemonName = formatPokemonName(name);
            });
          }
        } catch { /* Species IDs still remain available. */ }
      }
      next.sort((a, b) => a.pokemonId - b.pokemonId || a.name.localeCompare(b.name, 'pl'));
      // Pokédex remembers every documented draw, including species no longer owned.
      const grouped = new Map();
      const addSpecies = (id, name) => {
        if (!Number.isInteger(id) || id < 1 || id > 1025) return null;
        if (!grouped.has(id)) grouped.set(id, {
          pokemonId:id, pokemonName:formatPokemonName(name), trainers:[]
        });
        const record = grouped.get(id);
        if (!record.pokemonName && name) record.pokemonName = formatPokemonName(name);
        return record;
      };
      for (const row of next) {
        addSpecies(row.pokemonId, row.pokemonName).trainers.push({
          login:row.login, name:row.name
        });
        for (const old of row.history) addSpecies(old.pokemonId, old.pokemonName);
      }
      // New Cloud payload can include older discoveries that exceed the
      // displayed per-trainer history limit.
      if (Array.isArray(payload.discovered)) {
        for (const old of payload.discovered) {
          addSpecies(Number(old?.pokemonId), old?.pokemonName);
        }
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
    const info = make('div', 'pokemon-dex-info');
    info.append(make('strong', 'pokemon-species',
      item.pokemonName || 'Pokémon #' + item.pokemonId));
    if (item.trainers.length) info.append(make('p', 'pokemon-dex-owners',
      item.trainers.slice(0,2).map(person => '@' + person.name).join(', ') +
      (item.trainers.length > 2 ? ' +' + (item.trainers.length - 2) : '')));
    else card.classList.add('pokemon-dex-unowned');
    const foot = make('div', 'pokemon-dex-footer');
    foot.append(make('span', 'pokemon-dex-trainers', 'Trenerów: ' + fmt(item.trainers.length)));
    body.append(portrait, info);
    card.append(head, body, foot);
    return card;
  };

  const trainerHistory = item => {
    const block = make('section', 'pokemon-trainer-history');
    // The current Pokémon is already present in the collapsed card; the
    // expanded list should show past draws, even if a species repeats.
    const previous = item.history.filter((record, index, all) =>
      !(index === all.length - 1 && record.pokemonId === item.pokemonId));
    const records = [...previous].reverse();
    const title = make('div', 'pokemon-trainer-history-head');
    title.append(make('span', '', 'POPRZEDNIE POKÉMONY'));
    title.append(make('span', '', fmt(records.length)));
    block.append(title);
    const list = make('div', 'pokemon-trainer-history-list');
    const createChip = record => {
      const chip = make('span', 'pokemon-trainer-history-chip');
      chip.append(
        make('small', '', '#' + String(record.pokemonId).padStart(4,'0')),
        make('span', '', record.pokemonName || 'Pokémon #' + record.pokemonId),
        make('small', '', generation(record.pokemonId).label)
      );
      chip.title = [formatDate(record.at), generation(record.pokemonId).region,
        record.type === 'first' ? 'Pierwsze przypisanie' :
        record.type === 'purchase' ? 'Starsze płatne losowanie' : 'Losowanie',
        record.approximate ? 'Dane historyczne (niepełne)' : ''].filter(Boolean).join(' · ');
      return chip;
    };
    if (records.length) {
      const shown = records.slice(0, 8);
      list.append(...shown.map(createChip));
      if (records.length > shown.length) {
        const button = make('button', 'pokemon-history-more',
          'Pokaż wszystkie (+' + fmt(records.length - shown.length) + ')');
        button.type = 'button';
        button.setAttribute('aria-expanded','false');
        button.addEventListener('click', () => {
          const expand = button.getAttribute('aria-expanded') !== 'true';
          list.replaceChildren(...(expand ? records : shown).map(createChip));
          button.setAttribute('aria-expanded', String(expand));
          button.textContent = expand ? 'Pokaż mniej' :
            'Pokaż wszystkie (+' + fmt(records.length - shown.length) + ')';
        });
        block.append(list,button);
      } else block.append(list);
    } else {
      block.append(make('div', 'pokemon-trainer-history-note', 'Brak wcześniejszych zapisów.'));
    }
    if (item.joinEstimated)
      block.append(make('small','pokemon-trainer-history-note',
        'Historia sprzed włączenia zapisu losowań może być niepełna.'));
    return block;
  };

  const trainerCard = item => {
    const card = make('details', 'pokemon-trainer-card');
    const summary = make('summary', 'pokemon-trainer-summary');
    const user = make('div', 'pokemon-trainer-user');
    const badge = make('div', 'pokemon-trainer-avatar',
      item.joinOrder ? '#' + fmt(item.joinOrder) : '?');
    const date = formatDate(item.joinedAt);
    badge.title = item.joinEstimated
      ? 'Kolejność oszacowana z zachowanych danych' + (date ? ' · ' + date : '')
      : 'Dołączył do kolekcji' + (date ? ' · ' + date : '');
    const who = make('div', 'pokemon-trainer-person');
    who.append(make('strong', '', item.name), make('span', '', '@' + item.login));
    const gen = generation(item.pokemonId);
    const genChip = make('span', 'pokemon-gen', gen.label);
    genChip.title = gen.region;
    user.append(badge, who, genChip);
    const assigned = make('div', 'pokemon-trainer-assigned');
    assigned.append(artwork(item));
    const data = make('div', 'pokemon-trainer-pokemon');
    data.append(
      make('span', 'pokemon-number', '#' + String(item.pokemonId).padStart(4,'0')),
      make('strong', '', item.pokemonName || 'Pokémon #' + item.pokemonId)
    );
    assigned.append(data);
    summary.append(user, assigned);
    const details = make('div', 'pokemon-trainer-details');
    details.append(trainerHistory(item));
    card.append(summary, details);
    return card;
  };

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