/* Public Y.U.R.A. statistics: no invented values and no sensitive OAuth in browser. */
(() => {
  'use strict';
  const root=document.getElementById('statisticsView');
  if(!root)return;
  const base='https://yura-cloud.heiyeshi.workers.dev';
  const status=root.querySelector('#statsStatus');
  const rowsEl=root.querySelector('#statsViewerRows');
  const sortControl=root.querySelector('#statsSort');
  const search=root.querySelector('#statsSearch');
  const tabs=Array.from(root.querySelectorAll('.stats-scope'));
  const nf=new Intl.NumberFormat('pl-PL');
  let records=[],loaded=false,selected='all';
  let sort='messages';
  const number=x=>Number.isFinite(Number(x))?nf.format(Math.max(0,Number(x))):'—';
  const value=(obj,field)=>obj?.[field]===null||obj?.[field]===undefined?'—':number(obj[field]);
  function followAge(iso){
    if(!iso)return '—';
    const d=new Date(iso),now=Date.now();
    if(Number.isNaN(d.getTime())||d.getTime()>now)return '—';
    const days=Math.floor((now-d.getTime())/86400000);
    if(days>=365){const years=Math.floor(days/365);return years+' '+(years===1?'rok':years<5?'lata':'lat');}
    if(days>=30){const months=Math.floor(days/30);return months+' mies.';}
    return days+' dni';
  }
  const setText=(sel,text)=>{const el=root.querySelector(sel);if(el)el.textContent=text};
  function make(tag,klass,text){
    const el=document.createElement(tag);if(klass)el.className=klass;
    if(text!==undefined)el.textContent=String(text);return el;
  }
  function render(){
    const q=search.value.trim().toLocaleLowerCase('pl-PL');
    const matches=records.filter(row=>(selected==='all'||selected==='gamble'&&
      ((Number(row.gambleAllWins)||0)+(Number(row.gambleAllLosses)||0)>0))&&
      String(row.name||row.login).toLocaleLowerCase('pl-PL').includes(q));
    matches.sort((a,b)=>Number(b[sort]||0)-Number(a[sort]||0)||
      String(a.name||a.login).localeCompare(String(b.name||b.login),'pl'));
    rowsEl.replaceChildren();
    if(!matches.length){
      const card=make('div','stats-empty',loaded?'Brak widzów spełniających kryteria.':'Statystyki jeszcze nie są dostępne.');
      rowsEl.append(card);return;
    }
    for(const item of matches){
      const row=make('div','stats-viewer-row');
      row.append(make('strong','stats-viewer-name',item.name||item.login),
        make('span','',value(item,'messages')),
        make('span','',followAge(item.followedAt)),
        make('span','',value(item,'gambleAllWins')),
        make('span','',value(item,'gambleAllLosses')),
        make('span','',item.gambleAllWins!==null&&item.gambleAllLosses!==null &&
          Number(item.gambleAllWins)+Number(item.gambleAllLosses)>0?
          Math.round(100*Number(item.gambleAllWins)/(Number(item.gambleAllWins)+Number(item.gambleAllLosses)))+'%':'—'));
      rowsEl.append(row);
    }
  }
  tabs.forEach(button=>button.addEventListener('click',()=>{
    selected=button.dataset.scope;
    for(const tab of tabs){
      tab.classList.toggle('active',tab===button);
      tab.setAttribute('aria-pressed',String(tab===button));
    }
    render();
  }));
  search.addEventListener('input',render);
  sortControl.addEventListener('change',()=>{sort=sortControl.value;render()});
  let pending=false;
  async function load(){
    if(pending)return;
    pending=true;status.textContent='POBIERANIE DANYCH';
    try{
      const r=await fetch(base+'/api/public-stats',{cache:'no-store'});
      if(!r.ok)throw Error('HTTP '+r.status);
      const data=await r.json();
      if(data?.minMessages!==10||!Array.isArray(data?.viewers))throw Error('Nieobsługiwany format odpowiedzi');
      records=data.viewers.filter(row=>Number(row.messages)>=10);
      loaded=true;
      const c=data.channel||{};
      setText('#statsTotalMessages',value(c,'messages'));
      setText('#statsActiveViewers',value(c,'eligibleViewers'));
      setText('#statsTotalFollowers',value(c,'followers'));
      setText('#statsAllGambles',c.gambleAllWins!=null&&c.gambleAllLosses!=null?
        number(Number(c.gambleAllWins)+Number(c.gambleAllLosses)):'—');
      setText('#statsChannelLive',c.streamLive===true?'TRANSMISJA TRWA':c.streamLive===false?'OFFLINE':'BRAK DANYCH');
      const since=data.trackedSince?new Date(data.trackedSince):null;
      setText('#statsCoverage',since&&!Number.isNaN(since.getTime())?
        'Statystyki od '+since.toLocaleDateString('pl-PL')+
        ' • uwzględniono osoby z min. 10 wiadomościami.':'Statystyki od uruchomienia rejestrowania w Y.U.R.A. Cloud.');
      status.textContent='STATYSTYKI Y.U.R.A.';
      status.classList.add('is-loaded');
      render();
    }catch(e){
      loaded=false;records=[];
      status.textContent='OCZEKIWANIE NA CLOUD';
      setText('#statsCoverage','Strona jest gotowa. Dane pojawią się po aktualizacji Y.U.R.A. Cloud — bez wymyślonych wyników.');
      render();
    }finally{pending=false;}
  }
  document.addEventListener('yura:statistics-open',load);
  if(!root.hidden)load();
})();