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
  const marketPanel = root.querySelector('#pokemonMarketPanel');
  const commandsPanel = root.querySelector('#pokemonCommandsPanel');
  const commandsGrid = root.querySelector('#pokemonCommandsGrid');
  const commandsResultCount = root.querySelector('#pokemonCommandsResultCount');
  const marketGrid = root.querySelector('#pokemonMarketGrid');
  const marketCount = root.querySelector('#pokemonMarketCount');
  const marketSummary = root.querySelector('#pokemonMarketSummary');
  const marketResultCount = root.querySelector('#pokemonMarketResultCount');
  const marketRefresh = root.querySelector('#pokemonMarketRefresh');
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
  let trades = [], marketLoadedAt = 0, marketLoading = null;
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
    (item.roster||[]).some(p => norm(p.pokemonName).includes(term) || String(p.pokemonId).includes(term)) ||
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
          history: Array.isArray(row?.history) ? row.history.map(historyEvent).filter(Boolean) : [],
          slotsUnlocked:Math.max(1,Math.min(5,Number(row?.slotsUnlocked)||1)),
          roster:Array.isArray(row?.roster) ? row.roster.filter(p=>
            Number.isInteger(Number(p?.slot)) && Number(p.slot)>=1 && Number(p.slot)<=5 &&
            Number.isInteger(Number(p?.pokemonId)) && Number(p.pokemonId)>=1 && Number(p.pokemonId)<=1025)
            .map(p=>({slot:Number(p.slot),pokemonId:Number(p.pokemonId),
              pokemonName:formatPokemonName(p.pokemonName)})) : []
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
        const owned = row.roster.length ? row.roster : [{pokemonId:row.pokemonId,pokemonName:row.pokemonName}];
        for (const pokemon of owned) addSpecies(pokemon.pokemonId,pokemon.pokemonName).trainers.push({
          login:row.login,name:row.name
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
    // Always show every owned species in the collapsed card; never grow its height.
    const assigned = make('div', 'pokemon-trainer-assigned pokemon-trainer-roster-compact');
    const roster = (item.roster.length ? item.roster : [{slot:1,pokemonId:item.pokemonId,pokemonName:item.pokemonName}])
      .slice().sort((a,b)=>a.slot-b.slot);
    assigned.setAttribute('aria-label', 'Posiadane Pokémony: ' +
      roster.map(p=>p.pokemonName).join(', '));
    for (const pokemon of roster) {
      const tile = make('div','pokemon-trainer-mini');
      tile.title = pokemon.pokemonName + ' (#' + String(pokemon.pokemonId).padStart(4,'0') + ')';
      tile.append(artwork(pokemon),make('span','pokemon-trainer-mini-name',pokemon.pokemonName));
      assigned.append(tile);
    }
    summary.append(user, assigned);
    const details = make('div', 'pokemon-trainer-details');
    const rosterSection=make('section','pokemon-trainer-roster');
    rosterSection.append(make('div','pokemon-trainer-history-head',
      'KOLEKCJA  ' + (item.roster.length||1) + '/' + (item.slotsUnlocked||1) + ' • MAX 5'));
    const rosterList=make('div','pokemon-trainer-roster-list');
    for(const pokemon of (item.roster.length ? item.roster : [item])){
      const chip=make('span','pokemon-trainer-history-chip');
      chip.append(make('small','', '#' + String(pokemon.pokemonId).padStart(4,'0')),
        make('span','',pokemon.pokemonName));
      rosterList.append(chip);
    }
    if((item.slotsUnlocked||1)<5)
      rosterList.append(make('small','pokemon-trainer-history-note',
        'Następne miejsce: ' + ({1:'30 000',2:'120 000',3:'250 000',4:'400 000'}[item.slotsUnlocked]||'—') + ' YURA'));
    rosterSection.append(rosterList);
    details.append(rosterSection,trainerHistory(item));
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


  async function loadMarket(force = false) {
    if (!force && marketLoadedAt && Date.now() - marketLoadedAt < 15000) return;
    if (marketLoading) return marketLoading;
    marketLoading = (async () => {
      const response = await fetch(cloud + '/api/pokemon/market/history', {cache:'no-store'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (payload?.ok !== true || !Array.isArray(payload.trades))
        throw new Error('Niepoprawna odpowiedź historii transakcji.');
      trades = payload.trades.filter(item =>
        [item.pokemonId,item.wantedPokemonId].every(id =>
          Number.isInteger(Number(id)) && Number(id) >= 1 && Number(id) <= 1025) &&
        Number.isFinite(Number(item.price)) && Number(item.price) >= 10000 &&
        Number.isFinite(Date.parse(item.completedAt)));
      marketLoadedAt = Date.now();
    })().finally(() => { marketLoading = null; });
    return marketLoading;
  }
  function renderMarket() {
    if (!marketPanel) return;
    const term = query();
    const filtered = trades.filter(t => !term ||
      [t.seller,t.buyer,t.pokemonName,t.wantedPokemonName,
        String(t.pokemonId),String(t.wantedPokemonId),String(t.price)].some(v => norm(v).includes(term)));
    marketCount.textContent = fmt(trades.length);
    marketResultCount.textContent = fmt(filtered.length) + ' ZAKOŃCZONYCH TRANSAKCJI';
    marketGrid.replaceChildren();
    if (!filtered.length) {
      errorMessage(marketGrid,
        term ? 'Nie znaleziono pasującej transakcji.' : 'Brak zakończonych wymian.',
        term ? 'Spróbuj wyszukać trenera, nazwę Pokémona lub kwotę.' :
          'Po zaakceptowaniu wymiany na Twitchu pojawi się tutaj zapis transakcji.');
      return;
    }
    for (const trade of filtered) {
      const card = make('article','pokemon-market-card');
      const top = make('div','pokemon-market-top');
      top.append(make('span','pokemon-market-label','WYMIANA ZAKOŃCZONA'));
      const completed = new Date(trade.completedAt);
      top.append(make('span','pokemon-market-expiry',
        completed.toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})));
      const item = make('div','pokemon-market-pokemon');
      item.append(artwork({
        pokemonId:Number(trade.pokemonId),
        pokemonName:formatPokemonName(trade.pokemonName)
      }));
      const info = make('div','pokemon-market-info');
      info.append(
        make('strong','',formatPokemonName(trade.pokemonName) + '  ↔  ' + formatPokemonName(trade.wantedPokemonName)),
        make('span','pokemon-number','#' + String(trade.pokemonId).padStart(4,'0') +
          '  ↔  #' + String(trade.wantedPokemonId).padStart(4,'0')));
      item.append(info);
      const bottom = make('div','pokemon-market-bottom');
      bottom.append(make('span','pokemon-market-target',
        '@' + String(trade.seller).slice(0,25) + ' otrzymał(a) ' +
        formatPokemonName(trade.wantedPokemonName) + ' i ' + fmt(Number(trade.price)) + ' YURA. ' +
        '@' + String(trade.buyer).slice(0,25) + ' otrzymał(a) ' +
        formatPokemonName(trade.pokemonName) + '.'));
      bottom.append(make('strong','pokemon-market-price','+' + fmt(Number(trade.price)) + ' YURA'));
      card.append(top,item,bottom);
      marketGrid.append(card);
    }
  }
  async function showMarket(force = false) {
    if (mode !== 'market' || !visible()) return;
    marketCount.textContent = '…';
    try {
      await loadMarket(force);
      if (mode === 'market' && visible()) renderMarket();
    } catch {
      errorMessage(marketGrid,'Nie można pobrać historii z YURA Cloud.','Spróbuj odświeżyć później.');
      marketCount.textContent = '—';
    }
  }

  const pokemonCommands = [
    {command:'!pokemon',usage:'!pokemon',role:'FOLLOWER',cost:'DARMOWE',description:'Pierwszy raz losuje darmowego Pokémona. Później pokazuje aktualnie posiadanego.'},
    {command:'!pokeslots',usage:'!pokeslots',role:'FOLLOWER',cost:'DARMOWE',description:'Pokazuje Twoje Pokémony, liczbę kupionych miejsc (maksymalnie 5) oraz koszt następnego miejsca.'},
    {command:'!pokebuy',usage:'!pokebuy',role:'FOLLOWER',cost:'30K / 120K / 250K / 400K',description:'Kupuje permanentnie kolejne miejsce na Pokémona. Cztery miejsca kosztują łącznie 800 000 YURA Points.'},
    {command:'!pokeroll',usage:'!pokeroll [nazwa Pokémona]',role:'FOLLOWER',cost:'5 000 YURA',description:'Przy więcej niż jednym odblokowanym miejscu wymagane jest podanie nazwy, np. !pokeroll charizard. Wolne miejsce zostaje wypełnione bez utraty Charizarda; przy pełnej kolekcji zostaje on zastąpiony.'},
    {command:'!pokesell',usage:'!pokesell @nick 10000',role:'FOLLOWER',cost:'MIN. 10 000 YURA',description:'Wystawia ofertę wymiany Pokémonów z dopłatą od kupującego. Oferta jest ważna 5 minut.'},
    {command:'!pokeaccept',usage:'!pokeaccept',role:'FOLLOWER',cost:'WYMIANA',description:'Akceptuje otrzymaną ofertę. Pokémony są wymieniane, a kupujący przekazuje ustaloną kwotę sprzedającemu.'},
    {command:'!pokecancel',usage:'!pokecancel',role:'EVERYONE',cost:'BEZ OPŁAT',description:'Anuluje własną aktywną ofertę wymiany bez przenoszenia Pokémonów ani punktów.'},
    {command:'!pokedecline',usage:'!pokedecline',role:'EVERYONE',cost:'BEZ OPŁAT',description:'Odrzuca skierowaną do Ciebie ofertę bez przenoszenia Pokémonów ani punktów.'}
  ];
  function renderCommands() {
    if (!commandsPanel || !commandsGrid) return;
    const term = query();
    const matched = pokemonCommands.filter(item => !term ||
      [item.command,item.usage,item.role,item.cost,item.description].some(value => norm(value).includes(term)));
    commandsGrid.replaceChildren();
    commandsResultCount.textContent = fmt(matched.length) + ' KOMEND';
    if (!matched.length) {
      errorMessage(commandsGrid,'Nie znaleziono pasującej komendy.','Spróbuj innej nazwy lub opisu.');
      return;
    }
    for (const command of matched) {
      const card = make('article','pokemon-command-card');
      const meta = make('div','pokemon-command-meta');
      meta.append(make('span','pokemon-command-role',command.role),make('span','pokemon-command-cost',command.cost));
      const heading = make('h3','pokemon-command-name',command.command);
      const description = make('p','pokemon-command-description',command.description);
      const usage = make('div','pokemon-command-usage');
      const syntax = make('code','',command.usage);
      const copy = make('button','pokemon-command-copy','Kopiuj');
      copy.type = 'button';
      copy.setAttribute('aria-label','Kopiuj składnię ' + command.usage);
      copy.addEventListener('click',async () => {
        try {
          await navigator.clipboard.writeText(command.usage);
          copy.textContent = 'Skopiowano';
        } catch {
          copy.textContent = 'Zaznacz składnię';
          const selection = window.getSelection();
          if (selection) {
            const range = document.createRange();
            range.selectNodeContents(syntax);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      });
      usage.append(syntax,copy);
      card.append(meta,heading,description,usage);
      commandsGrid.append(card);
    }
  }

  function render() {
    if (mode === 'commands') { renderCommands(); return; }
    if (!loadedAt) return;
    if (mode === 'dex') renderDex();
    else if (mode === 'trainers') renderTrainers();
    else if (mode === 'market') renderMarket();
  }
  function setMode(next) {
    if (next !== 'dex' && next !== 'trainers' && next !== 'market' && next !== 'commands') return;
    mode = next;
    tabs.forEach(tab => {
      const active = tab.dataset.pokemonMode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    dexPanel.hidden = mode !== 'dex';
    trainersPanel.hidden = mode !== 'trainers';
    marketPanel.hidden = mode !== 'market';
    commandsPanel.hidden = mode !== 'commands';
    dexSummary.hidden = mode !== 'dex';
    trainersSummary.hidden = mode !== 'trainers';
    marketSummary.hidden = mode !== 'market';
    search.placeholder = mode === 'dex' ? 'Szukaj Pokémona lub numeru…' :
      mode === 'trainers' ? 'Szukaj trenera lub Pokémona…' :
      mode === 'market' ? 'Szukaj transakcji, trenera lub Pokémona…' : 'Szukaj komendy Pokémon…';
    search.value = '';
    render();
    if (mode === 'market') void showMarket(true);
  }
  tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.pokemonMode)));
  root.querySelector('.pokemon-tabs').addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const modes = ['dex','trainers','market','commands'];
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = modes[(modes.indexOf(mode) + delta + modes.length) % modes.length];
    setMode(next);
    tabs.find(tab => tab.dataset.pokemonMode === next)?.focus();
  });
  search.addEventListener('input', render);
  dexMore.addEventListener('click', () => renderDex(true));
  trainersMore.addEventListener('click', () => renderTrainers(true));
  marketRefresh.addEventListener('click', () => void showMarket(true));

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