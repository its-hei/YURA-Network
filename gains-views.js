/* GAINS presentation: Kubon-style top showcase, metric banner and
   Ranking/Zwycięzcy tabs INSIDE the lower standings card.
   The existing leaderboard layout always remains mounted and visible. */
(() => {
  'use strict';
  const host = document.getElementById('leaderboardView');
  const layout = host?.querySelector('.leaderboard-layout');
  const mainCol = layout?.querySelector('.leaderboard-main-col');
  if (!host || !layout || !mainCol || document.getElementById('gainsViews')) return;

  const board = document.createElement('section');
  board.id = 'gainsViews';
  board.className = 'gains-table-panel';
  board.setAttribute('aria-label','Miesięczny ranking EXP i zwycięzcy');
  board.hidden = true;
  board.innerHTML =
    '<div class="gains-table-toolbar">' +
      '<div class="gains-table-tabs" role="tablist" aria-label="Widoki GAINS">' +
        '<button type="button" class="gains-table-tab active" data-gains-view="ranking" role="tab" aria-selected="true">' +
          'Ranking <span class="gains-tab-count" id="gainsRankingCount">0</span></button>' +
        '<button type="button" class="gains-table-tab" data-gains-view="winners" role="tab" aria-selected="false">' +
          'Zwycięzcy <span class="gains-tab-count" id="gainsWinnersCount">0</span></button>' +
      '</div>' +
      '<span class="gains-table-sort" id="gainsTableSort">↓ EXP malejąco</span>' +
    '</div>' +
    '<div class="gains-table-columns">' +
      '<span>#</span><span>UŻYTKOWNIK</span><span id="gainsTableScoreHead">ZDOBYTY EXP</span>' +
    '</div>' +
    '<div class="gains-table-list" id="gainsTableList" aria-live="polite">' +
      '<div class="gains-table-empty"><strong>Wczytywanie GAINS…</strong></div>' +
    '</div>';
  mainCol.prepend(board);

  // GAINS replaces the old #2/#3 side stack with ONE two-section VIP card.
  // The original #2/#3 stack remains untouched for LEVELS and POINTS.
  const topSide = document.getElementById('leaderboardTopSide');
  const vipCard = document.createElement('aside');
  vipCard.id = 'gainsLastWinnerCard';
  vipCard.className = 'gains-last-winner-card';
  vipCard.setAttribute('aria-label','Ostatni zwycięzca miesięcznego VIP-a');
  vipCard.hidden = true;
  vipCard.innerHTML =
    '<div class="gains-last-winner-top">' +
      '<div class="gains-last-winner-kicker"><span aria-hidden="true">★</span> OSTATNI ZWYCIĘZCA VIP</div>' +
      '<div class="gains-last-winner-person">' +
        '<span class="gains-last-winner-avatar"><span id="gainsWinnerInitials">GE</span>' +
          '<img id="gainsWinnerAvatar" alt="" loading="lazy" decoding="async"></span>' +
        '<div class="gains-last-winner-identity"><strong id="gainsWinnerName">wielki_gekon_expiciel</strong>' +
          '<small id="gainsWinnerSource">Wskazany przez właściciela kanału</small></div>' +
      '</div>' +
    '</div>' +
    '<div class="gains-last-winner-result">' +
      '<span class="gains-last-winner-label">WYNIK ZWYCIĘSKIEGO MIESIĄCA</span>' +
      '<strong class="gains-last-winner-points" id="gainsWinnerWinningExp">—</strong>' +
      '<span class="gains-last-winner-detail" id="gainsWinnerWinningNote">Brak potwierdzonego wyniku zakończonego miesiąca.</span>' +
      '<span class="gains-last-winner-live" id="gainsWinnerCurrentGain"></span>' +
    '</div>';
  topSide?.after(vipCard);
  const winnerName = vipCard.querySelector('#gainsWinnerName');
  const winnerSource = vipCard.querySelector('#gainsWinnerSource');
  const winnerWinningExp = vipCard.querySelector('#gainsWinnerWinningExp');
  const winnerWinningNote = vipCard.querySelector('#gainsWinnerWinningNote');
  const winnerCurrentGain = vipCard.querySelector('#gainsWinnerCurrentGain');
  const winnerAvatar = vipCard.querySelector('#gainsWinnerAvatar');
  const winnerInitials = vipCard.querySelector('#gainsWinnerInitials');
  let winnerImageLogin = '';
  let datedSnapshot = false;

  function drawWinnerPanel(){
    const month = currentMonth();
    const data = liveData?.monthlyVip || null;
    const granted = data?.current?.status==='granted' ? data.current : null;
    const past = Array.isArray(data?.history) ? data.history
      .filter(item=>item?.status==='granted' &&
        /^\d{4}-\d{2}$/.test(String(item.wonMonth||item.won_month||'')) &&
        String(item.wonMonth||item.won_month)<month)
      .sort((a,b)=>String(b.wonMonth||b.won_month).localeCompare(String(a.wonMonth||a.won_month)))[0]
      : null;
    // User-confirmed current VIP; use a verified Cloud winner once available.
    const winner = granted || past || {
      login:'wielki_gekon_expiciel',name:'wielki_gekon_expiciel',
      source:'Wskazany przez właściciela kanału'
    };
    const winnerLogin = identity(winner);
    winnerName.textContent = display(winner);
    winnerSource.textContent = granted || past
      ? 'Miesięczny VIP • zwycięzca za '+String(winner.wonMonth||winner.won_month||'poprzedni miesiąc')
      : 'Obecny VIP • wskazany przez właściciela kanału';
    const winningRaw = winner.gainedExp ?? winner.gained_exp ??
      winner.winningExp ?? winner.winning_exp ?? null;
    const hasWinningExp = winningRaw!==null &&
      Number.isFinite(Number(winningRaw)) && Number(winningRaw)>=0 &&
      Boolean(granted||past);
    winnerWinningExp.textContent = hasWinningExp
      ? '+'+fmt.format(Number(winningRaw))+' EXP' : '—';
    winnerWinningNote.textContent = hasWinningExp
      ? 'Potwierdzony wynik zakończonego miesiąca.'
      : 'Wynik zwycięstwa nie jest jeszcze udostępniany przez Cloud.';
    const present = rankingRows.find(row=>identity(row)===winnerLogin);
    const hasPresent = present && Number.isFinite(Number(present.points));
    winnerCurrentGain.textContent = hasPresent
      ? 'Aktualny GAINS: +'+fmt.format(Math.max(0,Number(present.points)))+
        ' EXP'+(datedSnapshot?' • odczyt 26.10':'')+' (to nie wynik wygranej).'
      : '';
    const portrait = rankingRows.find(row=>identity(row)===winnerLogin) || winner;
    const imageKey=winnerLogin+':'+String(portrait.avatarMode||'')+':'+String(portrait.pokemonId||'');
    if (winnerImageLogin!==imageKey) {
      winnerImageLogin=imageKey;
      winnerAvatar.classList.remove('is-loaded');
      winnerAvatar.removeAttribute('src');
      winnerInitials.hidden=false;
      winnerInitials.textContent=display(winner).slice(0,2).toUpperCase();
      if (validLogin(portrait) && typeof leaderboardResolveAvatar==='function') {
        leaderboardResolveAvatar(portrait,winnerLogin).then(url=>{
          if (!url || !winnerAvatar.isConnected || winnerImageLogin!==imageKey) return;
          winnerAvatar.onload=()=>{
            if (winnerAvatar.isConnected && winnerAvatar.naturalWidth>0){
              winnerAvatar.classList.add('is-loaded');winnerInitials.hidden=true;
            }
          };
          winnerAvatar.onerror=()=>winnerAvatar.classList.remove('is-loaded');
          winnerAvatar.src=url;
        }).catch(()=>{});
      }
    }
  }

  const rowsHost = board.querySelector('#gainsTableList');
  const countRanking = board.querySelector('#gainsRankingCount');
  const countWinners = board.querySelector('#gainsWinnersCount');
  const sort = board.querySelector('#gainsTableSort');
  const scoreHead = board.querySelector('#gainsTableScoreHead');
  const search = document.getElementById('leaderboardSearchInput');
  const candidateButton = document.getElementById('leaderboardEligibilityToggle');
  const fmt = new Intl.NumberFormat('pl-PL');
  let section = 'ranking';
  let rankingRows = [];
  let liveData = null;
  let missing = false;
  const identity = row => String(row?.login || row?.name || '').trim().toLowerCase();
  const validLogin = row => /^[a-z0-9_]{2,25}$/.test(identity(row));
  const display = row => String(row?.name || row?.displayName || row?.login || '—');

  function makeImage(row) {
    const shell = document.createElement('span');
    shell.className = 'gains-board-avatar';
    const initials = document.createElement('span');
    initials.className = 'gains-board-initials';
    initials.textContent = display(row).slice(0,2).toUpperCase();
    shell.append(initials);
    const img = document.createElement('img');
    img.className = 'gains-board-photo';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    shell.append(img);
    if (validLogin(row) && typeof leaderboardResolveAvatar === 'function') {
      if (typeof leaderboardPokemonArtwork === 'function' && leaderboardPokemonArtwork(row))
        img.classList.add('pokemon');
      leaderboardResolveAvatar(row, identity(row)).then(url => {
        if (!url || !img.isConnected) return;
        img.onload = () => {
          if (!img.isConnected || img.naturalWidth < 1) return;
          img.classList.add('loaded');
          initials.hidden = true;
        };
        img.onerror = () => img.classList.remove('loaded');
        img.src = url;
      }).catch(() => {});
    }
    return shell;
  }
  function createRow(entry, rank, winner) {
    const el = document.createElement('div');
    el.className = 'gains-board-row' + (rank===1?' leader':'') + (winner?' winner':'');
    const pos = document.createElement('span');
    pos.className = 'gains-board-position';
    pos.textContent = String(rank).padStart(2,'0');

    const person = document.createElement('span');
    person.className = 'gains-board-person';
    const name = document.createElement('strong');
    name.textContent = display(entry);
    person.append(name);
    if (!winner && entry.isMonthlyVipExcluded === true) {
      const info = document.createElement('small');
      info.textContent = 'Poza konkursem VIP';
      person.append(info);
    }

    const measure = document.createElement('span');
    measure.className = 'gains-board-value';
    const val = document.createElement('strong');
    val.textContent = winner
      ? fmt.format(Number(entry.wins))
      : '+' + fmt.format(Math.max(0,Number(entry.points)||0));
    const unit = document.createElement('small');
    const wins = Number(entry.wins)||0;
    unit.textContent = winner
      ? (wins === 1?'WYGRANY MIESIĄC':wins < 5?'WYGRANE MIESIĄCE':'WYGRANYCH MIESIĘCY')
      : 'EXP';
    measure.append(val,unit);
    el.append(pos,makeImage(entry),person,measure);
    return el;
  }
  function showEmpty(title, explanation) {
    const box = document.createElement('div');
    box.className = 'gains-table-empty';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const p = document.createElement('p');
    p.textContent = explanation;
    box.append(strong,p);
    rowsHost.replaceChildren(box);
  }
  function currentMonth() {
    const parts = new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'2-digit',timeZone:'Europe/Warsaw'}).formatToParts(new Date());
    return parts.find(p=>p.type==='year').value + '-' + parts.find(p=>p.type==='month').value;
  }
  function confirmedWinners() {
    const monthly = liveData?.monthlyVip;
    const current = currentMonth();
    // The API's winners summary is authoritative; if month detail is supplied,
    // reject unfinished months. Never derive a winner from the current TOP 1.
    if (Array.isArray(monthly?.winners)) {
      return monthly.winners.filter(x=>{
        if (!x || !(x.login || x.name)) return false;
        if (x.month && String(x.month) >= current) return false;
        return Number.isSafeInteger(Number(x.wins)) && Number(x.wins)>0;
      }).map(x=>({...x,wins:Number(x.wins)}))
        .sort((a,b)=>b.wins-a.wins || display(a).localeCompare(display(b),'pl'));
    }
    const records = Array.isArray(monthly?.history)?monthly.history:[];
    const map = new Map();
    for (const item of records) {
      const month = String(item?.wonMonth || item?.won_month || '');
      const who = identity(item);
      if (item?.status !== 'granted' || !validLogin(item) ||
          !/^\d{4}-\d{2}$/.test(month) || month >= current) continue;
      const prior = map.get(who) || {login:who,name:display(item),wins:0,months:[]};
      if (!prior.months.includes(month)) { prior.months.push(month); prior.wins++; }
      map.set(who,prior);
    }
    return [...map.values()].sort((a,b)=>b.wins-a.wins||display(a).localeCompare(display(b),'pl'));
  }
  function render() {
    const all = rankingRows.slice().sort((a,b)=>Number(b.points)-Number(a.points));
    const eligible = typeof state !== 'undefined' && state.leaderboardHidePrivileged;
    const topTen = (eligible ? all.filter(x=>x.isMonthlyVipExcluded!==true) : all).slice(0,10);
    const champions = confirmedWinners();
    countRanking.textContent = String(topTen.length);
    countWinners.textContent = String(champions.length);
    const viewingWinners = section === 'winners';
    sort.textContent = viewingWinners ? '↓ Liczba zwycięstw' : '↓ EXP malejąco';
    scoreHead.textContent = viewingWinners ? 'WYGRANE MIESIĄCE' : 'ZDOBYTY EXP';

    const term = (search?.value||'').trim().toLocaleLowerCase('pl-PL');
    const entries = viewingWinners ? champions : topTen;
    const shown = term
      ? entries.filter(row=>display(row).toLocaleLowerCase('pl-PL').includes(term))
      : entries;
    if (!shown.length) {
      if (term) showEmpty('Nie znaleziono widza','Spróbuj zmienić wyszukiwaną nazwę.');
      else if (viewingWinners) showEmpty('Oczekujemy na pierwszego zwycięzcę',
        'Pierwszy okres GAINS rozpoczął się 25 października 2026. Wygrane miesiące pojawią się tu dopiero po zakończeniu okresu i potwierdzeniu nagrody.');
      else showEmpty(missing?'Cloud nie przekazuje miesięcznego EXP':'Brak wyników GAINS',
        'Wyniki pojawią się po opublikowaniu zweryfikowanego miesięcznego EXP.');
      return;
    }
    rowsHost.replaceChildren(...shown.map(row=>createRow(row,entries.indexOf(row)+1,viewingWinners)));
  }
  function syncVisibility() {
    const gainsActive = host.querySelector('.yura-ranking-tab.active')?.dataset.rankMode === 'gains';
    board.hidden = !gainsActive;
    host.classList.toggle('gains-table-active',gainsActive);
    // Crucial: never hide the #1/#2/#3 hero panels, record banner or sidebar.
    layout.hidden = false;
    vipCard.hidden = !gainsActive;
    if (gainsActive) drawWinnerPanel();
    for (const button of board.querySelectorAll('.gains-table-tab')) {
      const active = button.dataset.gainsView === section;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',String(active));
    }
  }
  board.querySelectorAll('.gains-table-tab').forEach(button=>button.addEventListener('click',()=>{
    section = button.dataset.gainsView;
    syncVisibility();
    render();
  }));
  search?.addEventListener('input',render);
  candidateButton?.addEventListener('click',()=>{if(section==='ranking')render();});
  document.addEventListener('yura:ranking-mode',syncVisibility);
  function acceptData(detail) {
    if (detail?.mode!=='gains') return;
    rankingRows = Array.isArray(detail.rows)?detail.rows:[];
    liveData = detail.data || null;
    missing = detail.missing===true;
    datedSnapshot = detail.dated===true;
    render();
    drawWinnerPanel();
    syncVisibility();
  }
  document.addEventListener('yura:ranking-data',event=>acceptData(event.detail));
  if (window.yuraGainsLastDetail) acceptData(window.yuraGainsLastDetail);
  else { syncVisibility(); render(); }
})();
