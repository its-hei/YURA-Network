/* Public Pokédex: fetches only after the user opens the Pokémon collection.
   Uses existing /api/ranking assignments. Never stores OAuth or charges points. */
(() => {
  'use strict';
  const root=document.getElementById('statsPokemonCollection');
  const stats=document.getElementById('statisticsView');
  if(!root||!stats)return;
  const list=root.querySelector('#pokemonCollectionRows');
  const more=root.querySelector('#pokemonCollectionMore');
  const counter=root.querySelector('#pokemonCollectionCount');
  const cloud='https://yura-cloud.heiyeshi.workers.dev';
  const endpoint=cloud+'/api/pokemon/collection';
  const legacyEndpoint=cloud+'/api/ranking';
  const sprites='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  const batchSize=18;
  let entries=[],checkedAt=0,inflight=null,displayed=0,query='',loaded=false;
  const norm=x=>String(x??'').trim().toLocaleLowerCase('pl-PL');
  function text(tag,value,className=''){
    const el=document.createElement(tag);
    if(className)el.className=className;
    el.textContent=String(value);
    return el;
  }
  function message(title,detail){
    const card=text('div',title,'stats-empty');
    if(detail)card.append(text('p',detail));
    list.replaceChildren(card);
    more.hidden=true;
  }
  async function load(){
    if(loaded&&Date.now()-checkedAt<10*60*1000)return;
    if(inflight)return inflight;
    message('Ładowanie kolekcji…','Pobieramy tylko przypisania Pokémonów, bez prywatnych danych.');
    inflight=(async()=>{
      // The dedicated endpoint includes EVERY assigned Pokémon and its species
      // name; the old ranking remains a read-only fallback until Cloud is updated.
      let response=await fetch(endpoint,{cache:'no-store'});
      let data=null;
      if(response.ok){
        data=await response.json();
        if(!Array.isArray(data?.entries))throw Error('nieobsługiwany format kolekcji Cloud');
      }else if(response.status===404){
        response=await fetch(legacyEndpoint,{cache:'no-store'});
        if(!response.ok)throw Error('HTTP '+response.status);
        data=await response.json();
        if(!Array.isArray(data?.gains))throw Error('nieobsługiwany format starego Cloud');
      }else throw Error('HTTP '+response.status);
      const source=Array.isArray(data.entries)?data.entries:data.gains;
      const seen=new Set();
      entries=source.filter(item=>{
        const user=norm(item?.login||item?.name);
        const id=Number(item?.pokemonId ?? item?.pokemon_id);
        if(!/^[a-z0-9_]{2,25}$/.test(user)||
           !Number.isInteger(id)||id<1||id>1025||
           !['pokemon',''].includes(norm(item?.avatarMode??item?.avatar_mode??''))||
           seen.has(user))return false;
        seen.add(user);return true;
      }).map(item=>({
        login:String(item.login||item.name),
        name:String(item.name||item.login),
        pokemonId:Number(item.pokemonId??item.pokemon_id),
        pokemonName:String(item.pokemonName||item.pokemon_name||'').trim()
      })).sort((a,b)=>a.name.localeCompare(b.name,'pl'));
      loaded=true;checkedAt=Date.now();
    })().finally(()=>{inflight=null});
    return inflight;
  }
  function createCard(item){
    const card=document.createElement('article');
    card.className='pokemon-collection-card';
    const picture=document.createElement('div');
    picture.className='pokemon-collection-picture';
    const img=document.createElement('img');
    img.alt='';
    img.loading='lazy';
    img.decoding='async';
    img.width=120;img.height=120;
    img.src=sprites+'other/official-artwork/'+item.pokemonId+'.png';
    img.onerror=()=>{
      if(img.dataset.fallback)return;
      img.dataset.fallback='1';
      img.src=sprites+item.pokemonId+'.png';
    };
    picture.append(img);
    const details=document.createElement('div');
    details.className='pokemon-collection-info';
    details.append(text('small','#'+String(item.pokemonId).padStart(4,'0'),'pokemon-collection-number'));
    details.append(text('strong',item.pokemonName||'Pokémon #'+item.pokemonId));
    details.append(text('span','@'+item.name,'pokemon-collection-owner'));
    card.append(picture,details);
    return card;
  }
  const filtered=()=>{
    const term=norm(query).replace(/^@/,'');
    return entries.filter(item=>!term||norm(item.login).includes(term)||
      norm(item.name).includes(term)||norm(item.pokemonName).includes(term)||
      String(item.pokemonId).includes(term));
  };
  function render(reset=true){
    if(!loaded)return;
    if(reset)displayed=0;
    const current=filtered();
    counter.textContent=current.length+' '+(current.length===1?'POKÉMON': 'POKÉMONÓW');
    if(!current.length){
      message(query?'Nie znaleziono Pokémona ani widza.':'Kolekcja jest jeszcze pusta.',
        'Pierwszy Pokémon pojawi się po użyciu przez widza komendy !pokemon.');
      return;
    }
    if(reset)list.replaceChildren();
    const next=current.slice(displayed,displayed+batchSize);
    list.append(...next.map(createCard));
    displayed+=next.length;
    more.hidden=displayed>=current.length;
    more.textContent='Pokaż kolejne ('+Math.min(batchSize,current.length-displayed)+')';
  }
  more.addEventListener('click',()=>render(false));
  document.addEventListener('yura:pokemon-collection',async event=>{
    const info=event.detail||{};
    if(!info.active)return;
    const nextQuery=String(info.query||'');
    const differs=nextQuery!==query;
    query=nextQuery;
    try{
      await load();
      if(root.hidden)return;
      render(differs||!displayed);
    }catch(err){
      message('Nie można teraz pobrać kolekcji.',
        'Cloud nie udostępnił listy Pokémonów. Spróbuj ponownie później.');
      counter.textContent='—';
    }
  });
})();
