/* Public GAINS views: a complete top ten and confirmed historical winners.
   Kept separate from LEVELS / POINTS and from the Cloud account economy. */
(() => {
  'use strict';
  const host=document.getElementById('leaderboardView');
  const layout=host?.querySelector('.leaderboard-layout');
  if (!host || !layout || document.getElementById('gainsViews')) return;

  const root=document.createElement('div');
  root.className='gains-views';
  root.id='gainsViews';
  root.hidden=true;
  root.innerHTML=[
    '<div class="gains-subnav" role="tablist" aria-label="Podstrony GAINS">',
      '<button type="button" class="gains-subtab active" data-subtab="ranking" role="tab" aria-selected="true">Ranking</button>',
      '<button type="button" class="gains-subtab" data-subtab="winners" role="tab" aria-selected="false">Zwycięzcy</button>',
    '</div>',
    '<section id="gainsRankingPane" class="gains-pane">',
      '<div class="gains-title-row">',
        '<div><span class="gains-eyebrow">GAINS / MIESIĘCZNY EXP</span>',
          '<h2>TOP 10 widzów</h2><p>Ranking EXP zdobytego w aktualnym miesiącu.</p></div>',
        '<span id="gainsDataStamp" class="gains-data-stamp">WCZYTYWANIE…</span>',
      '</div>',
      '<div class="gains-toolbar">',
        '<label class="gains-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Szukaj w TOP 10..." aria-label="Szukaj widza w rankingu GAINS"></label>',
        '<button type="button" class="gains-filter" aria-pressed="false">KANDYDACI VIP</button>',
      '</div>',
      '<div class="gains-board" id="gainsRankingRows" aria-label="Ranking GAINS od 1 do 10">',
        '<div class="gains-empty"><strong>Wczytywanie GAINS…</strong></div>',
      '</div>',
      '<div class="gains-metrics">',
        '<div class="gains-metric"><span>REKORD GAINS OD POCZĄTKU ZAPISÓW</span><strong id="gainsBestValue">—</strong><p id="gainsBestDetail">Brak potwierdzonych danych.</p></div>',
        '<div class="gains-metric"><span>AKTUALNY VIP Z POPRZEDNIEGO MIESIĄCA</span><strong id="gainsCurrentVip">—</strong><p id="gainsCurrentVipDetail">Pierwszy okres rozpoczął się 25.10.2026.</p></div>',
      '</div>',
    '</section>',
    '<section id="gainsWinnersPane" class="gains-pane" hidden>',
      '<div class="gains-title-row"><div><span class="gains-eyebrow">HISTORIA GAINS</span>',
      '<h2>Zwycięzcy miesięcy</h2><p>Avatar, nick i liczba wygranych zakończonych miesięcy.</p>',
      '</div></div>',
      '<div class="gains-board gains-winners-board" id="gainsWinnerRows"></div>',
    '</section>'
  ].join('');
  layout.before(root);
  const ranking=root.querySelector('#gainsRankingPane');
  const winners=root.querySelector('#gainsWinnersPane');
  const rankingRows=root.querySelector('#gainsRankingRows');
  const winnerRows=root.querySelector('#gainsWinnerRows');
  const search=root.querySelector('.gains-search input');
  const filter=root.querySelector('.gains-filter');
  let subtab='ranking',onlyCandidates=false;
  let gainRows=[],rankingData=null,dated=false,missing=false;
  const fmt=new Intl.NumberFormat('pl-PL');
  const nick=e=>String(e?.login||e?.name||'').trim().toLowerCase();
  const validLogin=e=>/^[a-z0-9_]{2,25}$/.test(nick(e));
  const set=(selector,value)=>{const node=root.querySelector(selector);if(node)node.textContent=value;};

  function avatarNode(entry){
    const shell=document.createElement('span');
    shell.className='gains-avatar-shell';
    const initials=document.createElement('span');
    initials.className='gains-avatar-placeholder';
    initials.textContent=String(entry.name||entry.login||'?').slice(0,2).toUpperCase();
    shell.appendChild(initials);
    const img=document.createElement('img');
    img.className='gains-avatar';
    img.alt='';
    img.loading='lazy';
    img.decoding='async';
    shell.appendChild(img);
    if(validLogin(entry) && typeof leaderboardResolveAvatar==='function'){
      if(typeof leaderboardPokemonArtwork==='function' && leaderboardPokemonArtwork(entry))
        img.classList.add('is-pokemon');
      leaderboardResolveAvatar(entry,nick(entry)).then(url=>{
        if(!url||!img.isConnected)return;
        img.onload=()=>{if(img.isConnected&&img.naturalWidth>0){img.classList.add('loaded');initials.hidden=true;}};
        img.onerror=()=>img.classList.remove('loaded');
        img.src=url;
      }).catch(()=>{});
    }
    return shell;
  }
  function entryNode(entry,rank,isWinner){
    const element=document.createElement('div');
    element.className='gains-entry'+(rank===1?' leader':'')+(isWinner?' winner':'');
    const pos=document.createElement('span');
    pos.className='gains-place';
    pos.textContent=String(rank).padStart(2,'0');
    const name=document.createElement('div');
    name.className='gains-person';
    const title=document.createElement('strong');
    title.textContent=String(entry.name||entry.login||'—');
    name.appendChild(title);
    if(!isWinner && entry.isMonthlyVipExcluded===true){
      const hint=document.createElement('small');hint.textContent='Poza konkursem VIP';name.appendChild(hint);
    }
    const score=document.createElement('div');
    score.className='gains-score';
    const amount=document.createElement('strong');
    amount.textContent=isWinner?fmt.format(Number(entry.wins)):('+'+fmt.format(Math.max(0,Number(entry.points)||0)));
    const unit=document.createElement('small');
    unit.textContent=isWinner?(Number(entry.wins)===1?'WYGRANY MIESIĄC':'WYGRANE MIESIĄCE'):'EXP';
    score.append(amount,unit);
    element.append(pos,avatarNode(entry),name,score);
    return element;
  }
  function empty(parent,heading,description){
    const node=document.createElement('div');
    node.className='gains-empty';
    const strong=document.createElement('strong');strong.textContent=heading;
    const p=document.createElement('p');p.textContent=description;
    node.append(strong,p);
    parent.replaceChildren(node);
  }
  function drawRanking(){
    if(!gainRows.length){
      empty(rankingRows,missing?'Cloud nie przekazuje miesięcznego EXP':'Brak wyników GAINS',
        'Ranking będzie widoczny, kiedy zweryfikowane miesięczne EXP będzie dostępne.');
      return;
    }
    const all=onlyCandidates?gainRows.filter(e=>e.isMonthlyVipExcluded!==true):gainRows;
    const top=all.slice(0,10);
    const term=search.value.trim().toLocaleLowerCase('pl-PL');
    const visible=term?top.filter(e=>String(e.name||e.login).toLocaleLowerCase('pl-PL').includes(term)):top;
    if(!visible.length){
      empty(rankingRows,'Nie znaleziono widza','Zmień wyszukiwanie lub filtr kandydatów VIP.');
      return;
    }
    const nodes=visible.map(entry=>entryNode(entry,top.indexOf(entry)+1,false));
    rankingRows.replaceChildren(...nodes);
  }
  function historicalWinners(data){
    const api=data?.monthlyVip;
    if(Array.isArray(api?.winners)){
      return api.winners.filter(item=>item && (item.login||item.name) &&
        Number.isSafeInteger(Number(item.wins)) && Number(item.wins)>0)
        .map(item=>({...item,wins:Number(item.wins)}))
        .sort((a,b)=>b.wins-a.wins||String(a.name||a.login).localeCompare(String(b.name||b.login),'pl'));
    }
    // Some Worker versions expose raw granted award history instead.
    const history=Array.isArray(api?.history)?api.history:[];
    const grouped=new Map();
    for(const award of history){
      const month=String(award?.wonMonth||award?.won_month||'');
      const login=String(award?.login||'').toLowerCase();
      if(award?.status!=='granted'||!validLogin({login})||!/^\d{4}-\d{2}$/.test(month))continue;
      const previous=grouped.get(login)||{login,name:award.name||award.display_name||login,wins:0,months:[]};
      if(!previous.months.includes(month)){previous.months.push(month);previous.wins++;}
      grouped.set(login,previous);
    }
    return [...grouped.values()].sort((a,b)=>b.wins-a.wins||String(a.name).localeCompare(String(b.name),'pl'));
  }
  function drawWinners(){
    const rows=historicalWinners(rankingData);
    if(!rows.length){
      empty(winnerRows,'Oczekujemy na pierwszego zwycięzcę',
        'Pierwszy okres GAINS trwa od 25 do 31 października 2026. Tu pojawią się wyłącznie potwierdzone wygrane zakończonych miesięcy, nie aktualni liderzy.');
      return;
    }
    winnerRows.replaceChildren(...rows.map((entry,i)=>entryNode(entry,i+1,true)));
  }
  function drawMetrics(){
    const record=rankingData?.records?.bestMonthlyGain;
    const snapshot=dated?gainRows[0]:null;
    const metric=record||snapshot;
    const value=record?.exp??(snapshot?.points??null);
    set('#gainsBestValue',value!==null&&Number.isFinite(Number(value))?
      '+'+fmt.format(Number(value))+' EXP':'—');
    set('#gainsBestDetail',metric?
      String(metric.name||metric.login||'')+' • '+(record?.month||'odczyt 26.10 (nie wynik końcowy)'):
      'Rekord pojawi się po zapisaniu miesięcznych wyników.');
    const current=rankingData?.monthlyVip?.current;
    const active=current&&current.status==='granted';
    set('#gainsCurrentVip',active?String(current.name||current.login):'Brak potwierdzonego VIP-a');
    set('#gainsCurrentVipDetail',active?'Zwycięzca za '+(current.wonMonth||'poprzedni miesiąc'):
      'Pierwszy okres GAINS: 25–31.10.2026.');
  }
  function sync(){
    const active=host.querySelector('.yura-ranking-tab.active')?.dataset.rankMode==='gains';
    root.hidden=!active;
    layout.hidden=active;
    ranking.hidden=subtab!=='ranking';
    winners.hidden=subtab!=='winners';
    root.querySelectorAll('.gains-subtab').forEach(button=>{
      const chosen=button.dataset.subtab===subtab;
      button.classList.toggle('active',chosen);
      button.setAttribute('aria-selected',String(chosen));
    });
  }
  root.querySelectorAll('.gains-subtab').forEach(btn=>btn.addEventListener('click',()=>{
    subtab=btn.dataset.subtab;
    sync();
    if(subtab==='ranking')drawRanking();else drawWinners();
  }));
  search.addEventListener('input',drawRanking);
  filter.addEventListener('click',()=>{
    onlyCandidates=!onlyCandidates;
    filter.classList.toggle('active',onlyCandidates);
    filter.setAttribute('aria-pressed',String(onlyCandidates));
    filter.textContent=onlyCandidates?'POKAŻ WSZYSTKICH':'KANDYDACI VIP';
    drawRanking();
  });
  document.addEventListener('yura:ranking-mode',event=>{sync();});
  document.addEventListener('yura:ranking-data',event=>{
    if(event.detail?.mode!=='gains')return;
    gainRows=Array.isArray(event.detail.rows)?event.detail.rows:[];
    rankingData=event.detail.data;
    dated=event.detail.dated===true;
    missing=event.detail.missing===true;
    set('#gainsDataStamp',dated?'ODCZYT 26.10.2026':'SYNCHRONIZACJA CO 5 MIN');
    drawRanking();
    drawWinners();
    drawMetrics();
    sync();
  });
  drawWinners();
  sync();
})();