/* YURA v3.3.95. Add this script AFTER the existing app.js in index.html.
   Its hooks reuse the site's existing presentation rather than copying or replacing
   schedule/profile/commands code. It deliberately never guesses missing GAINS. */
(() => {
  'use strict';
  const host = document.getElementById('leaderboardView');
  if (!host || typeof renderLeaderboard !== 'function' || typeof loadLeaderboard !== 'function') return;
  const modes = ['gains', 'level', 'points'];
  let selected = 'gains';
  let gainsCandidatesOnly = false;
  let pending = false;
  let lastRanking = null;
  const originalLoad = loadLeaderboard;
  const originalRender = renderLeaderboard;
  const originalEligible = document.getElementById('leaderboardEligibilityToggle');
  const title = host.querySelector('.hero p');
  const listHeader = host.querySelector('.leaderboard-list-head span:last-child');
  const vipRule = host.querySelector('.monthly-vip-rule');
  const note = vipRule?.querySelector('p');
  const rankControls = document.createElement('div');
  rankControls.className = 'tabs yura-ranking-tabs';
  rankControls.setAttribute('role','tablist');
  rankControls.setAttribute('aria-label','Typ rankingu YURA');
  for (const mode of modes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab yura-ranking-tab' + (mode === selected ? ' active' : '');
    button.textContent = mode === 'level' ? 'LEVELS' : mode.toUpperCase();
    button.dataset.rankMode = mode;
    button.setAttribute('role','tab');
    button.setAttribute('aria-selected',String(mode===selected));
    button.addEventListener('click', async () => {
      if (selected === 'gains') gainsCandidatesOnly = state.leaderboardHidePrivileged;
      selected = mode;
      state.leaderboardHidePrivileged = mode === 'gains' && gainsCandidatesOnly;
      updateLabels();
      for (const item of rankControls.children) {
        item.classList.toggle('active',item.dataset.rankMode === selected);
        item.setAttribute('aria-selected',String(item.dataset.rankMode === selected));
      }
      if (mode === 'points') { await originalLoad(true); }
      else if (lastRanking) showRanking(lastRanking);
      else await fetchRanking();
      updateLabels();
    });
    rankControls.appendChild(button);
  }
  host.querySelector('.leaderboard-toolbar')?.before(rankControls);

  // Transparent public odds: each stake bracket has a 10x smaller probability after loss.
  if (vipRule && !host.querySelector('.yura-vip-odds')) {
    const details=document.createElement('details');
    details.className='yura-vip-odds';
    const odds=[[1000,'0,001%','0,0001%'],[5000,'0,003%','0,0003%'],
      [10000,'0,005%','0,0005%'],[25000,'0,01%','0,001%'],
      [50000,'0,02%','0,002%'],[100000,'0,04%','0,004%'],
      [250000,'0,07%','0,007%'],['500 000+','0,10%','0,01%']];
    details.innerHTML='<summary>PERMANENT VIP • dokładne szanse w !gamble all</summary>'+
      '<p>Dodatkowy los wyłącznie dla !gamble all, niezależny od wyniku gry. Przy porażce szansa jest dziesięciokrotnie mniejsza. Między progami rośnie płynnie. VIP zdobywa się tylko raz.</p>'+
      '<table><thead><tr><th>Stawka</th><th>Wygrana</th><th>Przegrana</th></tr></thead><tbody>'+
      odds.map(row=>'<tr><td>'+row[0]+'</td><td>'+row[1]+'</td><td>'+row[2]+'</td></tr>').join('')+
      '</tbody></table>';
    vipRule.after(details);
  }
  const oddsPanel = host.querySelector('.yura-vip-odds');

  function updateLabels() {
    if (title) title.textContent = selected === 'gains'
      ? 'Miesięczny przyrost poziomów EXP — największy przyrost wygrywa, nie najwyższy poziom.'
      : selected === 'level' ? 'Łączny poziom EXP od początku aktywności na kanale.'
      : 'Aktualne saldo YURA Points (może rosnąć i maleć przez gamble).';
    if (listHeader) listHeader.textContent = selected === 'gains' ? 'Zdobyte poziomy' : selected === 'level' ? 'Poziom' : 'Punkty';
    if (note) note.textContent = 'Miesięczny VIP: wygrywa osoba z największym przyrostem poziomów EXP (GAINS) w danym miesiącu — nie z najwyższym LEVEL ani saldem POINTS. ' +
      'Nagroda obowiązuje przez kolejny miesiąc i może zostać przedłużona po ponownym zwycięstwie. Stali VIP-i i moderatorzy nie są brani pod uwagę.';
    // The two VIP programs belong to different ranking tabs.
    if (vipRule) vipRule.hidden = selected !== 'gains';
    if (oddsPanel) oddsPanel.hidden = selected !== 'points';
    if (originalEligible) originalEligible.hidden = selected !== 'gains';
  }
  function showRanking(data) {
    const rows = Array.isArray(data?.[selected]) ? data[selected] : [];
    const convert = row => {
      const login = String(row.login || row.name || '').trim().toLowerCase();
      const display = String(row.name || '').trim().toLowerCase();
      const fallback = (typeof leaderboardMetadataByName !== 'undefined')
        ? (leaderboardMetadataByName.get(login) || leaderboardMetadataByName.get(display) || {}) : {};
      return {
      ...row,points: selected === 'gains' ? Number(row.gains || 0)
        : selected === 'level' ? Number(row.level || 0) : Number(row.points || 0),
      isVip: fallback.isVip === true || row.isPermanentVip === true,
      isModerator: fallback.isModerator === true,
      isMonthlyVipExcluded: selected === 'gains' ? (row.isMonthlyVipExcluded === true || fallback.isMonthlyVipExcluded === true || fallback.isVip === true || fallback.isModerator === true) : false,
      rankDelta: 0,isNew:false
      };
    };
    originalRender({entries:rows.map(convert), updatedAt:data.updatedAt || new Date().toISOString()});
    // The legacy renderer labels every value as YURA Points. Correct the labels
    // after rendering so GAINS never falsely appears to be currency.
    const displayUnit = selected === 'gains' ? 'LEVEL GAIN / THIS MONTH'
      : selected === 'level' ? 'TOTAL LEVEL' : 'Y.U.R.A. POINTS';
    for (const el of host.querySelectorAll('.podium-unit')) el.textContent = displayUnit;
    if (selected === 'gains') {
      for (const el of host.querySelectorAll('.podium-points, .leaderboard-points')) {
        if (el.textContent && !el.textContent.trim().startsWith('+'))
          el.textContent = '+' + el.textContent.trim() + ' LVL';
      }
    } else if (selected === 'level') {
      for (const el of host.querySelectorAll('.podium-points, .leaderboard-points'))
        if (el.textContent) el.textContent = 'LVL ' + el.textContent.trim();
    }
    const label=document.getElementById('leaderboardStatus');
    if (label) label.textContent = selected === 'gains' ? `GAINS ${data.month || ''}` : `${selected.toUpperCase()} • LIVE`;
  }
  async function fetchRanking() {
    if (pending || document.hidden) return;
    pending=true;
    try {
      const base=typeof YURA_CLOUD_BASE === 'string' ? YURA_CLOUD_BASE : 'https://yura-cloud.heiyeshi.workers.dev';
      const response=await fetch(base+'/api/ranking',{cache:'no-store'});
      if (!response.ok) throw new Error('ranking API HTTP '+response.status);
      if (typeof loadLeaderboardMetadata === 'function') await loadLeaderboardMetadata();
      const result=await response.json();
      if (!Array.isArray(result.gains)||!Array.isArray(result.level)||!Array.isArray(result.points)) throw new Error('ranking schema missing');
      lastRanking=result;
      if (selected!=='points') showRanking(result);
    } catch (error) {
      const label=document.getElementById('leaderboardStatus');
      if(label) label.textContent='GAINS / LEVEL OFFLINE';
      if(selected!=='points') originalRender({entries:[],updatedAt:null});
      console.warn('YURA monthly gains cannot be verified:',error);
    } finally { pending=false; }
  }
  // Reuse the existing 5-minute polling lifecycle, including hidden-tab suspension.
  loadLeaderboard = async function(force=false) {
    if (selected==='points') return originalLoad(force);
    return fetchRanking();
  };
  updateLabels();
  if (!document.hidden) fetchRanking();
})();
