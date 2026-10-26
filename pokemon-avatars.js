/* YURA Network: OAuth-authenticated Pokémon / Twitch avatar choice.
   The private OAuth access token lives in sessionStorage, never in a URL or public file.
   A new Pokémon costs 15,000 YURA only through the Cloud-owned !pokemon command. */
(() => {
  'use strict';
  const root=document.getElementById('pokemonAvatarPanel');
  if (!root) return;
  const base='https://yura-cloud.heiyeshi.workers.dev';
  const redirectUri='https://its-hei.github.io/YURA-Network/';
  const key='yura.pokemon.twitch-token.session';
  const stateKey='yura.pokemon.oauth-state';
  const status=root.querySelector('#pokemonAvatarStatus');
  const buttons=root.querySelector('#pokemonAvatarControls');
  const login=root.querySelector('#pokemonConnectTwitch');
  const twitch=root.querySelector('#pokemonShowTwitch');
  const pokemon=root.querySelector('#pokemonShowPokemon');
  const who=root.querySelector('#pokemonAccount');
  const sprite=root.querySelector('#pokemonCurrentSprite');
  const caption=root.querySelector('#pokemonSelectionInfo');
  let token='';
  let current=null;
  const setStatus=message=>{if(status)status.textContent=message;};
  const validId=id=>Number.isInteger(id)&&id>=1&&id<=1025;
  const randomState=()=>{
    const bytes=new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  };
  const validateRedirect=()=>{
    const hash=location.hash.startsWith('#')?new URLSearchParams(location.hash.substring(1)):null;
    if(!hash?.has('access_token')&&!hash?.has('error')) return;
    const expected=sessionStorage.getItem(stateKey);
    const returned=hash.get('state');
    const access=hash.get('access_token')||'';
    // Remove fragments from address bar immediately so they cannot leak to analytics.
    history.replaceState(null,'',location.pathname+location.search);
    sessionStorage.removeItem(stateKey);
    if(!expected||!returned||expected!==returned||!/^[a-zA-Z0-9]{15,150}$/.test(access)){
      setStatus('Nie udało się potwierdzić logowania Twitch. Spróbuj ponownie.');
      return;
    }
    sessionStorage.setItem(key,access);
    history.replaceState(null,'',location.pathname+'?yuraView=leaderboard');
    location.replace(location.pathname+'?yuraView=leaderboard');
  };
  const call=async(method,path,data)=>{
    const response=await fetch(base+path,{
      method,
      headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},
      ...(data?{body:JSON.stringify(data)}:{}),
      cache:'no-store'
    });
    if(response.status===401){
      sessionStorage.removeItem(key);token='';
      throw new Error('Sesja Twitch wygasła. Połącz konto ponownie.');
    }
    if(!response.ok)throw new Error('Y.U.R.A. Cloud nie odpowiada ('+response.status+').');
    return response.json();
  };
  const render=()=>{
    const connected=!!current;
    if(buttons)buttons.hidden=!connected;
    if(login)login.hidden=connected;
    if(!connected)return;
    if(who)who.textContent='@'+current.login;
    if(twitch)twitch.classList.toggle('active',current.avatarMode!=='pokemon');
    if(pokemon)pokemon.classList.toggle('active',current.avatarMode==='pokemon');
    const id=Number(current.pokemonId);
    if(sprite){
      sprite.hidden=!validId(id);
      if(validId(id))sprite.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/'+id+'.png';
    }
    if(caption)caption.textContent=validId(id)
      ? 'Twój Pokémon: '+(current.pokemonName||'#'+id)+' (#'+id+'). Zmienisz go na czacie: !pokemon nazwa — 15 000 Y.U.R.A. Points.'
      : 'Pierwszy Pokémon zostanie wylosowany po podłączeniu konta.';
  };
  async function loadProfile(){
    if(!token){current=null;render();return;}
    setStatus('Wczytywanie ustawień avatara…');
    try{
      current=await call('GET','/api/pokemon/profile');
      render();
      setStatus('Wybierz, co ma być widoczne obok Twojego nicku w rankingu.');
    } catch(error){
      current=null;render();
      setStatus(error.message||'Błąd pobierania avatara.');
    }
  }
  if(login)login.addEventListener('click',async()=>{
    if(!window.crypto?.getRandomValues||!window.sessionStorage){setStatus('Logowanie wymaga bezpiecznej przeglądarki.');return;}
    login.disabled=true;
    setStatus('Łączenie z Twitch…');
    try{
      const response=await fetch(base+'/api/pokemon/config',{cache:'no-store'});
      if(!response.ok)throw new Error('Y.U.R.A. Cloud nie jest jeszcze zaktualizowana.');
      const config=await response.json();
      if(!/^[a-z0-9]{20,40}$/i.test(config.clientId||''))throw new Error('Cloud nie udostępnia identyfikatora aplikacji Twitch.');
      const state=randomState();
      sessionStorage.setItem(stateKey,state);
      const url=new URL('https://id.twitch.tv/oauth2/authorize');
      url.searchParams.set('client_id',config.clientId);
      url.searchParams.set('redirect_uri',redirectUri);
      url.searchParams.set('response_type','token');
      url.searchParams.set('scope','');
      url.searchParams.set('state',state);
      location.assign(url.toString());
    }catch(error){setStatus(error.message);login.disabled=false;}
  });
  async function setMode(mode){
    if(!current||!token)return;
    twitch.disabled=pokemon.disabled=true;
    try{
      const response=await call('PUT','/api/pokemon/profile',{avatarMode:mode});
      current.avatarMode=response.avatarMode;
      render();
      setStatus('Ustawienie zapisane dla Twojego konta Twitch.');
      if(typeof loadLeaderboard==='function')await loadLeaderboard(true);
    }catch(error){setStatus(error.message||'Nie udało się zapisać ustawienia.');}
    finally{twitch.disabled=pokemon.disabled=false;}
  }
  twitch?.addEventListener('click',()=>setMode('twitch'));
  pokemon?.addEventListener('click',()=>setMode('pokemon'));
  try{
    validateRedirect();
    token=sessionStorage.getItem(key)||'';
    if(token)loadProfile();
    else setStatus('Połącz Twitch, aby wybrać avatar lub Pokémona. Pierwszy Pokémon jest losowy i darmowy.');
  }catch{setStatus('Nie można uruchomić logowania w tej przeglądarce.');}
})();
