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
      '<span class="gains-last-winner-live" id="gainsWinnerCurrentRank"></span>' +
    '</div>';
  topSide?.after(vipCard);
  const winnerName = vipCard.querySelector('#gainsWinnerName');
  const winnerSource = vipCard.querySelector('#gainsWinnerSource');
  const winnerWinningExp = vipCard.querySelector('#gainsWinnerWinningExp');
  const winnerWinningNote = vipCard.querySelector('#gainsWinnerWinningNote');
  const winnerCurrentRank = vipCard.querySelector('#gainsWinnerCurrentRank');
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
    // Placement always refers to the unfiltered list (VIPs and moderators included).
    const allRanks = rankingRows.slice().sort((a,b)=>Number(b.points)-Number(a.points));
    const fullPlace = allRanks.findIndex(row=>identity(row)===winnerLogin);
    winnerCurrentRank.textContent = fullPlace>=0
      ? 'Obecne miejsce w pełnym rankingu: #'+fmt.format(fullPlace+1)+
        (datedSnapshot?' • odczyt 26.10':'')
      : 'Obecne miejsce: brak w dostępnych danych rankingu';
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
    const eligible = state.leaderboardHidePrivileged;
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
  candidateButton?.addEventListener('click',()=>{
    // app.js toggles state before our listener runs; refresh both table and winner rank.
    render();
    drawWinnerPanel();
  });
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

  /* LEVELS & POINTS use the same GAINS #1 showcase and TOP 10 table.
     A dedicated information panel replaces the old #2/#3 stack. */
  const alternateTable=document.createElement('section');
  alternateTable.id='rankingUnifiedTable';
  alternateTable.className='gains-table-panel ranking-unified-table';
  alternateTable.setAttribute('aria-label','Pełna tabela TOP 10 LEVELS lub POINTS');
  alternateTable.hidden=true;
  alternateTable.innerHTML=
    '<div class="gains-table-toolbar"><div class="gains-table-tabs">'+
      '<span class="ranking-unified-title" id="rankingUnifiedTitle">TOP 10 LEVELS</span></div>'+
      '<span class="gains-table-sort" id="rankingUnifiedSort">↓ Poziom malejąco</span></div>'+
    '<div class="gains-table-columns"><span>#</span><span>UŻYTKOWNIK</span>'+
      '<span id="rankingUnifiedHead">POZIOM</span></div>'+
    '<div class="gains-table-list" id="rankingUnifiedRows" aria-live="polite"></div>';
  mainCol.prepend(alternateTable);
  const contextCard=document.createElement('aside');
  contextCard.id='rankingUnifiedInfo';
  contextCard.className='gains-last-winner-card ranking-unified-info';
  contextCard.setAttribute('aria-label','Informacje o rankingu LEVELS i POINTS');
  contextCard.hidden=true;
  contextCard.innerHTML=
    '<div class="ranking-unified-info-top">'+
      '<span class="ranking-unified-info-kicker" id="rankingInfoKicker">O RANKINGU</span>'+
      '<strong class="ranking-unified-info-heading" id="rankingInfoHeading">Jak działa ranking?</strong>'+
      '<p class="ranking-unified-info-copy" id="rankingInfoCopy"></p>'+
    '</div>'+
    '<div class="ranking-unified-info-bottom">'+
      '<span class="gains-last-winner-label" id="rankingInfoMetricTitle">WYNIK</span>'+
      '<strong class="gains-last-winner-points" id="rankingInfoMetric">—</strong>'+
      '<span class="gains-last-winner-detail" id="rankingInfoDetail"></span>'+
    '</div>';
  topSide?.after(contextCard);
  const alternateList=alternateTable.querySelector('#rankingUnifiedRows');
  const alternateTitle=alternateTable.querySelector('#rankingUnifiedTitle');
  const alternateSort=alternateTable.querySelector('#rankingUnifiedSort');
  const alternateHead=alternateTable.querySelector('#rankingUnifiedHead');
  let alternateMode='level';
  let alternateRows=[];
  const numberFor = (row, mode) => mode==='level'
    ? Math.max(0,Math.trunc(Number(row.level ?? row.points)||0))
    : Math.max(0,Math.trunc(Number(row.points)||0));
  function makeAlternateRow(row,rank,mode){
    const el=document.createElement('div');
    el.className='gains-board-row'+(rank===1?' leader':'');
    el.dataset.rank=String(rank);
    el.dataset.name=display(row);
    const place=document.createElement('span');
    place.className='gains-board-position';
    place.textContent=String(rank).padStart(2,'0');
    const person=document.createElement('span');
    person.className='gains-board-person';
    const name=document.createElement('strong');
    name.textContent=display(row);
    person.append(name);
    const value=document.createElement('span');
    value.className='gains-board-value';
    const strong=document.createElement('strong');
    strong.textContent=(mode==='level'?'LVL ':'')+fmt.format(numberFor(row,mode));
    const unit=document.createElement('small');
    unit.textContent=mode==='level'?'POZIOM':'Y.U.R.A. POINTS';
    value.append(strong,unit);
    el.append(place,makeImage(row),person,value);
    return el;
  }
  function renderAlternateInfo(mode,all,ten){
    const set=(id,value)=>{const el=contextCard.querySelector('#'+id);if(el)el.textContent=value;};
    const leader=all[0];
    if(mode==='level'){
      set('rankingInfoKicker','LEVELS • INFORMACJE');
      set('rankingInfoHeading','Poziom aktywności');
      set('rankingInfoCopy','LEVELS pokazuje łączny poziom osiągnięty przez widza od początku aktywności na kanale. W przeciwieństwie do GAINS nie resetuje się co miesiąc.');
      set('rankingInfoMetricTitle','EXP LIDERA');
      set('rankingInfoMetric',leader&&Number.isFinite(Number(leader.exp))?fmt.format(Math.max(0,Number(leader.exp)))+' EXP':'—');
      set('rankingInfoDetail',fmt.format(all.length)+' widzów w rankingu · postęp całkowity.');
    }else{
      set('rankingInfoKicker','POINTS • INFORMACJE');
      set('rankingInfoHeading','Punkty społeczności');
      set('rankingInfoCopy','POINTS to aktualne saldo Y.U.R.A. Points. Możesz je zdobywać za aktywność, a także wykorzystywać w zabawach na kanale.');
      set('rankingInfoMetricTitle','SALDO W TOP 10');
      set('rankingInfoMetric',fmt.format(ten.reduce((sum,item)=>sum+numberFor(item,mode),0)));
      set('rankingInfoDetail','Permanentny VIP jest dostępny poprzez !gamble all. Liczby mogą się zmieniać po każdej transakcji.');
    }
  }
  function renderAlternate(){
    const mode=alternateMode;
    const isLevel=mode==='level';
    const ten=alternateRows.slice(0,10);
    alternateTitle.textContent='TOP 10 '+(isLevel?'LEVELS':'POINTS');
    alternateSort.textContent=isLevel?'↓ Poziom malejąco':'↓ Saldo malejąco';
    alternateHead.textContent=isLevel?'POZIOM':'PUNKTY';
    const term=(search?.value||'').trim().toLocaleLowerCase('pl-PL');
    const rows=term?ten.filter(row=>display(row).toLocaleLowerCase('pl-PL').includes(term)):ten;
    if(rows.length){
      alternateList.replaceChildren(...rows.map(row=>makeAlternateRow(row,ten.indexOf(row)+1,mode)));
    }else{
      const empty=document.createElement('div');
      empty.className='gains-table-empty';
      const label=document.createElement('strong');
      label.textContent=term?'Nie znaleziono widza':'Brak wyników '+(isLevel?'LEVELS':'POINTS');
      const desc=document.createElement('p');
      desc.textContent=term?'Sprawdź nazwę lub wyczyść wyszukiwanie.':'Ranking pojawi się po synchronizacji z YURA Cloud.';
      empty.append(label,desc);
      alternateList.replaceChildren(empty);
    }
    renderAlternateInfo(mode,alternateRows,ten);
  }
  function syncAlternate(){
    const mode=host.querySelector('.yura-ranking-tab.active')?.dataset.rankMode||'gains';
    const active=mode==='level'||mode==='points';
    alternateTable.hidden=!active;
    contextCard.hidden=!active;
    host.classList.toggle('ranking-unified-active',active);
    if(active){alternateMode=mode;renderAlternate();}
  }
  search?.addEventListener('input',()=>{
    const mode=host.querySelector('.yura-ranking-tab.active')?.dataset.rankMode;
    if(mode==='level'||mode==='points')renderAlternate();
  });
  document.addEventListener('yura:ranking-data',event=>{
    const detail=event.detail;
    if(detail?.mode!=='level'&&detail?.mode!=='points')return;
    alternateMode=detail.mode;
    // Cloud /api/ranking already supplies the authoritative order (incl. tie-breaks).
    alternateRows=Array.isArray(detail.rows)?detail.rows.filter(x=>
      x&&(x.login||x.name)&&Number.isFinite(Number(x.points))):[];
    renderAlternate();
    syncAlternate();
  });
  document.addEventListener('yura:ranking-mode',syncAlternate);
  if(window.yuraGainsLastDetail?.mode==='level'||window.yuraGainsLastDetail?.mode==='points'){
    alternateMode=window.yuraGainsLastDetail.mode;
    alternateRows=window.yuraGainsLastDetail.rows||[];
  }
  syncAlternate();
})();
