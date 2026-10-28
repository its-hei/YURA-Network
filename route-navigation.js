/* YURA public section URLs — GitHub Pages-compatible client routing.
   A lightweight static bootstrap exists at each shareable path; this remains
   the only source of truth for page navigation and browser history. */
(() => {
  'use strict';

  const BASE = '/YURA-Network';
  const paths = Object.freeze({
    about: '/o-mnie',
    streammap: '/mapa',
    commands: '/komendy',
    leaderboard: '/yura',
    schedule: '/grafik',
    statistics: '/staty',
    pokemon: '/pokemon'
  });
  const titles = {
    about:'O mnie',streammap:'Mapa',commands:'Komendy',leaderboard:'Y.U.R.A.',
    schedule:'Grafik',statistics:'Staty',pokemon:'Pokémon'
  };
  const root = BASE + '/';
  const topLinks = [...document.querySelectorAll('.top-navigation [data-view]')];
  const rankTabs = [...document.querySelectorAll('.yura-ranking-tab[data-rank-mode]')];
  const pokemonTabs = [...document.querySelectorAll('[data-pokemon-mode]')];
  let applying = false;

  const currentUrl = () => new URL(window.location.href);
  const cleanPath = pathname =>
    ('/' + String(pathname).replace(/\/+/g, '/').replace(/^\/+|\/+$/g, ''))
      .replace(/\/+$/g, '') || '/';

  function lookup() {
    const url = currentUrl();
    const full = cleanPath(url.pathname);
    const short = full === BASE ? '/' :
      full.startsWith(BASE + '/') ? full.slice(BASE.length) : null;
    const route = short && short !== '/' ? short.toLowerCase() : '/';
    const byPath = {
      '/o-mnie':['about',null], '/mapa':['streammap',null],
      '/komendy':['commands',null], '/yura':['leaderboard','gains'],
      '/yura/gains':['leaderboard','gains'],
      '/yura/levels':['leaderboard','level'],
      '/yura/points':['leaderboard','points'],
      '/grafik':['schedule',null], '/staty':['statistics',null],
      '/pokemon':['pokemon','dex'],
      '/pokemon/pokedex':['pokemon','dex'],
      '/pokemon/trenerzy':['pokemon','trainers'],
      '/zmiany':['changelog',null]
    };
    if (short && route in byPath) {
      const [view, sub] = byPath[route];
      return {view, sub, path:paths[view] || '/zmiany', canonical:true};
    }
    // Backwards compatibility with historical ?yuraView= links.
    const legacy = url.searchParams.get('yuraView');
    const modes = {levels:'level',level:'level',gains:'gains',points:'points'};
    if (legacy === 'streammap' || legacy === 'mapa')
      return {view:'streammap',sub:null,legacy:true};
    if (legacy === 'levels' || legacy === 'level')
      return {view:'leaderboard',sub:'level',legacy:true};
    if (legacy === 'leaderboard' || legacy === 'yura')
      return {view:'leaderboard',sub:modes[url.searchParams.get('yuraMode')] || 'gains',legacy:true};
    if (legacy === 'pokemon')
      return {view:'pokemon',sub:url.searchParams.get('yuraMode') === 'trainers' ? 'trainers' : 'dex',legacy:true};
    if (legacy && Object.hasOwn(paths,legacy))
      return {view:legacy,sub:null,legacy:true};
    // '/' is the original homepage; keep its URL until someone selects a tab.
    return {view:'about',sub:null,homepage:true};
  }

  const urlFor = (view, sub = null) => {
    const slug = paths[view] || '/o-mnie';
    if (view === 'leaderboard' && sub)
      return BASE + '/yura/' + ({level:'levels',points:'points',gains:'gains'}[sub] || 'gains');
    if (view === 'pokemon' && sub)
      return BASE + '/pokemon/' + (sub === 'trainers' ? 'trenerzy' : 'pokedex');
    return BASE + slug;
  };

  function titleFor(view,sub) {
    const subTitle = view === 'leaderboard'
      ? ({gains:'Gains',level:'Levels',points:'Points'}[sub] || '')
      : view === 'pokemon' ? (sub === 'trainers' ? 'Pokémon Trainers' : sub === 'dex' ? 'Pokédex' : '') : '';
    return (subTitle ? subTitle + ' | ' : '') +
      (titles[view] || 'Heiyeshi') + ' — HEIYESHI';
  }

  function setMode(view, sub) {
    if (view === 'leaderboard') {
      const button = rankTabs.find(tab => tab.dataset.rankMode === (sub || 'gains'));
      // Avoid unnecessary work if tab is already selected.
      if (button && !button.classList.contains('active')) button.click();
    }
    if (view === 'pokemon') {
      const button = pokemonTabs.find(tab => tab.dataset.pokemonMode === (sub || 'dex'));
      if (button && !button.classList.contains('active')) button.click();
    }
  }

  function navigate(view, sub, replace = false) {
    const target = urlFor(view,sub);
    const url = currentUrl();
    if (cleanPath(url.pathname) !== target || url.search || url.hash) {
      const state = {yuraView:view,yuraSub:sub||null};
      if (replace) history.replaceState(state,'',target);
      else history.pushState(state,'',target);
    }
    document.title = titleFor(view,sub);
  }

  function applyUrl() {
    const loc = lookup();
    applying = true;
    try {
      if (typeof switchView === 'function') switchView(loc.view);
      setMode(loc.view,loc.sub);
      if (loc.legacy) navigate(loc.view,loc.sub,true);
      else {
        // Canonicalize the trailing slash added by GitHub Pages directory hosting.
        const current = currentUrl();
        const path = cleanPath(current.pathname);
        if (loc.canonical && (current.pathname !== path || current.search)) {
          history.replaceState({yuraView:loc.view,yuraSub:loc.sub||null},'',path);
        }
        document.title = titleFor(loc.view,loc.sub);
      }
    } finally {
      applying = false;
    }
  }

  topLinks.forEach(link => {
    const view = link.dataset.view;
    if (paths[view]) link.href = urlFor(view);
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || applying) return;
      applying = true;
      try {
        setMode(view,null); // Main Y.U.R.A. opens Gains; Pokémon opens Pokédex.
        navigate(view,null);
      } finally {
        applying = false;
      }
    });
  });

  rankTabs.forEach(tab => tab.addEventListener('click', () => {
    if (!applying) navigate('leaderboard',tab.dataset.rankMode);
  }));
  pokemonTabs.forEach(tab => tab.addEventListener('click', () => {
    if (!applying) navigate('pokemon',tab.dataset.pokemonMode);
  }));

  window.addEventListener('popstate',applyUrl);
  applyUrl();
})();
