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
  let verifiedSnapshot = null;
  let snapshotRequest = null;
  let gainsSnapshotActive = false;
  const currentWarsawMonth = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone:'Europe/Warsaw', year:'numeric', month:'2-digit'
    }).formatToParts(new Date());
    return parts.find(part => part.type==='year').value + '-' +
      parts.find(part => part.type==='month').value;
  };
  async function getVerifiedSnapshot() {
    if (!snapshotRequest) {
      snapshotRequest = fetch('./gains-exp-2026-10.json?v=1',{cache:'no-store'})
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          if (!data || data.month!=='2026-10' || !Array.isArray(data.entries) ||
              !data.entries.every(row => row.login && Number.isFinite(Number(row.baseExp)) &&
                Number.isFinite(Number(row.exp)) && Number.isFinite(Number(row.monthlyExp)) &&
                Number(row.monthlyExp)>=0 &&
                Number(row.exp)-Number(row.baseExp)===Number(row.monthlyExp))) return null;
          verifiedSnapshot = data;
          return data;
        }).catch(() => null);
    }
    return snapshotRequest;
  }
  function getSnapshotFor(data) {
    if (!verifiedSnapshot || verifiedSnapshot.month!==data?.month ||
        verifiedSnapshot.month!==currentWarsawMonth()) return null;
    const rows = Array.isArray(data.gains)?data.gains:[];
    // Prefer genuine live EXP once the Cloud Worker exposes it.
    if (rows.length && rows.every(row => row.monthlyExp!=null &&
        Number.isFinite(Number(row.monthlyExp)) && Number(row.monthlyExp)>=0)) return null;
    return verifiedSnapshot;
  }
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
  // Ranking tabs remain above both leader and runner-up panels.
  (host.querySelector('.leaderboard-layout') || host.querySelector('.leaderboard-toolbar'))?.before(rankControls);

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
  const milestone = document.getElementById('leaderboardMilestone');
  const milestoneTitle = document.getElementById('leaderboardMilestoneTitle');
  const milestoneValue = document.getElementById('leaderboardMilestoneValue');
  const milestoneCaption = document.getElementById('leaderboardMilestoneCaption');
  const plNumber = n => new Intl.NumberFormat('pl-PL').format(Number(n));
  const cadenceValue = host.querySelector('.leaderboard-sync-stats .leaderboard-meta strong');
  const updatedLabel = document.getElementById('leaderboardUpdated');
  const liveBadge = document.getElementById('leaderboardStatus');
  const currentVipBox = document.getElementById('leaderboardCurrentVip');
  const currentVipName = document.getElementById('leaderboardCurrentVipName');
  const currentVipNote = document.getElementById('leaderboardCurrentVipNote');
  function applyDatedSnapshotLabel() {
    const dated = selected==='gains' && gainsSnapshotActive && verifiedSnapshot;
    if (cadenceValue) cadenceValue.textContent = dated ? 'ODCZYT' : '5 MIN';
    if (!dated) return;
    if (liveBadge) {
      liveBadge.textContent = 'GAINS • ODCZYT 26.10';
      liveBadge.classList.remove('is-live');
    }
    if (updatedLabel) updatedLabel.textContent = '26.10.2026 • baza D1';
  }
  function renderCurrentVip(data) {
    if (!currentVipBox) return;
    currentVipBox.hidden = selected!=='gains';
    if (selected!=='gains') return;
    // The current month's GAINS leader is a candidate for NEXT month, never the current VIP.
    const winner = data?.monthlyVip?.current || data?.records?.currentMonthlyVip || null;
    // Display only an explicitly confirmed active winner, not a mere candidate.
    const confirmed = winner && typeof winner==='object' &&
      ['granted','active'].includes(String(winner.status || '').toLowerCase());
    const login = confirmed ? (winner.name || winner.displayName || winner.login || '') : '';
    if (login) {
      if (currentVipName) currentVipName.textContent = login;
      if (currentVipNote) currentVipNote.textContent = 'Zwycięzca GAINS z poprzedniego miesiąca.';
    } else {
      if (currentVipName) currentVipName.textContent = 'Brak potwierdzonego zwycięzcy';
      if (currentVipNote) currentVipNote.textContent = currentWarsawMonth()==='2026-10'
        ? 'Pierwszy zapis GAINS rozpoczął się 25.10.2026. Zwycięzca października będzie dotyczył listopada.'
        : 'Brak zweryfikowanego zwycięzcy poprzedniego miesiąca w publicznych danych Cloud.';
    }
  }
  function renderMilestone() {
    if (!milestone) return;
    milestone.hidden = selected === 'level';
    if (selected === 'level') return;
    const data = lastRanking?.records;
    if (selected === 'gains') {
      const record = data?.bestMonthlyGain;
      const topVerified = gainsSnapshotActive ? verifiedSnapshot?.entries?.[0] : null;
      if (milestoneTitle) milestoneTitle.textContent = topVerified
        ? 'Najwyższy potwierdzony GAINS • 26.10' : 'Rekord GAINS • od początku zapisów';
      if (milestoneValue) milestoneValue.textContent = topVerified
        ? '+' + plNumber(topVerified.monthlyExp) + ' EXP'
        : record && Number.isFinite(Number(record.exp)) ? '+' + plNumber(record.exp) + ' EXP' : '—';
      if (milestoneCaption) milestoneCaption.textContent = topVerified
        ? topVerified.name + ' • październik 2026 • odczyt, nie wynik końcowy'
        : record ? [record.name,record.month].filter(Boolean).join(' • ')
        : data ? 'Brak zapisanych miesięcznych wyników EXP.' : 'Rekord pojawi się po aktualizacji Y.U.R.A. Cloud.';
    } else {
      const count = data?.permanentVipWinners;
      if (milestoneTitle) milestoneTitle.textContent = 'Permanentny VIP • !gamble all';
      if (milestoneValue) milestoneValue.textContent = Number.isInteger(count) && count >= 0
        ? plNumber(count) : '—';
      if (milestoneCaption) milestoneCaption.textContent = Number.isInteger(count) && count >= 0
        ? 'Liczba osób, którym Twitch przyznał VIP-a po wygranej w losowaniu.'
        : 'Licznik pojawi się po aktualizacji Y.U.R.A. Cloud.';
    }
  }

  function updateLabels() {
    if (title) title.textContent = selected === 'gains'
      ? (gainsSnapshotActive
        ? 'Potwierdzony ranking EXP z 26.10.2026. To zapisany odczyt, nie wynik na żywo.'
        : 'Miesięczny przyrost EXP — największy zdobyty EXP wygrywa, nie najwyższy poziom.')
      : selected === 'level' ? 'Łączny poziom EXP od początku aktywności na kanale.'
      : 'Aktualne saldo YURA Points (może rosnąć i maleć przez gamble).';
    if (listHeader) listHeader.textContent = selected === 'gains' ? 'Zdobyty EXP' : selected === 'level' ? 'Poziom' : 'Punkty';
    if (note) note.textContent = 'Miesięczny VIP: wygrywa największy przyrost EXP (GAINS) od początku miesiąca, a nie najwyższy LEVEL ani saldo POINTS. ' +
      'Nagroda obowiązuje przez kolejny miesiąc i może zostać przedłużona po ponownym zwycięstwie. Stali VIP-i i moderatorzy nie są brani pod uwagę.';
    // The two VIP programs belong to different ranking tabs.
    if (vipRule) vipRule.hidden = selected !== 'gains';
    if (oddsPanel) oddsPanel.hidden = selected !== 'points';
    if (originalEligible) originalEligible.hidden = selected !== 'gains';
    renderMilestone();
    renderCurrentVip(lastRanking);
    applyDatedSnapshotLabel();
    document.dispatchEvent(new CustomEvent('yura:ranking-mode',{detail:{mode:selected,data:lastRanking,dated:gainsSnapshotActive}}));
  }
  // Preserve GAINS / LEVELS units whenever the search, VIP filter or live sync
  // redraws the ranking (including the #2/#3 side card).
  function applyRankingUnits() {
    const displayUnit = selected === 'gains' ? 'EXP W TYM MIESIĄCU'
      : selected === 'level' ? 'TOTAL LEVEL' : 'Y.U.R.A. POINTS';
    for (const el of host.querySelectorAll('.podium-unit')) el.textContent = displayUnit;
    for (const el of host.querySelectorAll('.podium-points, .leaderboard-points')) {
      const value = el.textContent.trim();
      if (!value) continue;
      if (selected === 'gains' && !value.startsWith('+')) el.textContent = '+' + value + ' EXP';
      if (selected === 'level' && !value.startsWith('LVL ')) el.textContent = 'LVL ' + value;
    }
  }
  renderLeaderboard = function(data) {
    originalRender(data);
    applyRankingUnits();
    applyDatedSnapshotLabel();
  };
  function showRanking(data) {
    const snapshot = selected==='gains'?getSnapshotFor(data):null;
    gainsSnapshotActive = Boolean(snapshot);
    const apiRows = Array.isArray(data?.[selected]) ? data[selected] : [];
    const byLogin = new Map((data?.gains || []).map(row => [
      String(row.login || row.name || '').toLowerCase(),row
    ]));
    const rows = snapshot ? snapshot.entries.map(row => ({
      ...byLogin.get(String(row.login).toLowerCase()),...row
    })) : apiRows;
    if (selected === 'gains' && rows.some(row => row.monthlyExp == null || !Number.isFinite(Number(row.monthlyExp)))) {
      renderLeaderboard({entries:[],updatedAt:data.updatedAt});
      const warning = document.getElementById('leaderboardStatus');
      if (warning) warning.textContent = 'GAINS EXP • BRAK DANYCH';
      document.dispatchEvent(new CustomEvent('yura:ranking-data',{detail:{mode:selected,rows:[],data,dated:false,missing:true}}));
      return;
    }
    const convert = row => {
      const login = String(row.login || row.name || '').trim().toLowerCase();
      const display = String(row.name || '').trim().toLowerCase();
      const fallback = (typeof leaderboardMetadataByName !== 'undefined')
        ? (leaderboardMetadataByName.get(login) || leaderboardMetadataByName.get(display) || {}) : {};
      return {
      ...row,points: selected === 'gains' ? Math.max(0,Number(row.monthlyExp))
        : selected === 'level' ? Number(row.level || 0) : Number(row.points || 0),
      isVip: fallback.isVip === true || row.isPermanentVip === true,
      isModerator: fallback.isModerator === true,
      isMonthlyVipExcluded: selected === 'gains' ? (row.isMonthlyVipExcluded === true || fallback.isMonthlyVipExcluded === true || fallback.isVip === true || fallback.isModerator === true) : false,
      rankDelta: 0,isNew:false
      };
    };
    const converted=rows.map(convert);
    renderLeaderboard({entries:converted, updatedAt:data.updatedAt || new Date().toISOString()});
    document.dispatchEvent(new CustomEvent('yura:ranking-data',{
      detail:{mode:selected,rows:converted,data,dated:gainsSnapshotActive}
    }));
    const label=document.getElementById('leaderboardStatus');
    if (label && !gainsSnapshotActive) label.textContent = selected === 'gains' ? `GAINS ${data.month || ''}` : `${selected.toUpperCase()} • LIVE`;
    updateLabels();
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
      if (selected==='gains') await getVerifiedSnapshot();
      renderMilestone();
      renderCurrentVip(result);
      if (selected!=='points') showRanking(result);
    } catch (error) {
      // A dated D1 snapshot may still be shown if the public API is unavailable.
      const snapshot=selected==='gains'?await getVerifiedSnapshot():null;
      if (snapshot && snapshot.month===currentWarsawMonth()) {
        lastRanking={month:snapshot.month,gains:[],level:[],points:[],updatedAt:null};
        showRanking(lastRanking);
      } else {
        const label=document.getElementById('leaderboardStatus');
        if(label) label.textContent='GAINS / LEVEL OFFLINE';
        if(selected!=='points') originalRender({entries:[],updatedAt:null});
      }
      console.warn('YURA live gains unavailable; dated snapshot used where possible:',error);
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
