import test from "node:test";
import assert from "node:assert/strict";
import {activeEventSet,renderFfxivCardText,renderFfxivCardEmbeds,deliverCard,updateFourPosts,expireFourPosts,refreshFfxivCardPalette,refreshFfxivEventCompact,refreshFfxivPatchEmbedOnly,refreshFfxivPatchBanner,ensureFfxivEmbedLinks,FFXIV_CARD_PALETTE} from "../src/ffxiv-dashboard.ts";
import {extractOfficialPatchHero} from "../src/ffxiv-news.ts";

const source="https://eu.finalfantasyxiv.com/lodestone/topics/detail/abc123";
const report="https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/report.png?ex=1234";
const backupDb=()=>{
  const store=new Map();
  return {DB:{prepare:()=>({bind:(...args)=>({
    first:async()=>({value:store.get(args[0])||""}),
    run:async()=>{store.set(args[0],args[1]);return {meta:{changes:1}}}
  })})},store};
};
const cases=[
  ["event",{id:"thepath",title:"The Path Infernal",url:source,end:Date.UTC(2026,11,9,14,59)},["The Path Infernal","Koniec:","Szczegóły wydarzenia"]],
  ["fashion",{id:"discord-fashion-week-460",title:"Week 460",url:"https://discord.com/channels/111/222/333",image:report,expires:Date.UTC(2026,10,24,8)},["👗 Reset: 24 listopada 2026 09:00","https://fashionreportxiv.com/"]],
  ["patch",{id:"7.58",title:"Patch 7.58 Notes",url:source},["Patch 7.58 Notes","Przeczytaj patch notes"]],
  ["dalamud",{id:"stable",title:"Dalamud Stable 15.0.4.1",url:"https://github.com/goatcorp/dalamud-distrib"},["Dalamud Stable 15.0.4.1","Wersja stabilna"]]
];

test("Event has a clickable headline above its official rich preview",()=>{
  const event={id:"thepath",title:"FINAL FANTASY XIV x FINAL FANTASY XVI Crossover Event Returns!",
    url:source,end:Date.UTC(2026,11,9,14,59)};
  assert.equal(renderFfxivCardText("event",event),"","native embed should be the only event link");
  const [embed]=renderFfxivCardEmbeds("event",event);
  assert.equal(embed.title,"The Path Infernal • FFXIV × FFXVI");
  assert.equal(embed.url,source,"title links directly to official event");
  assert.equal(embed.description,"**Trwa teraz** • koniec: 9 grudnia 2026 15:59 • <t:1796828340:R>\nNagrody: Torgal (mount), Metian Attire, Torgal Pup.");
  assert.equal(embed.color,0xF5A544);
  assert.equal(embed.footer.text,"Źródło: Lodestone • wydarzenia");
  const art="https://eu.finalfantasyxiv.com/images/crossover.jpg";
  assert.deepEqual(renderFfxivCardEmbeds("event",{...event,image:art})[0].image,
    {url:art},"restores the official preview image");
  const other={...event,title:"Starlight Celebration"};
  const [fallback]=renderFfxivCardEmbeds("event",other);
  assert.equal(fallback.title,"Starlight Celebration","other event titles remain unchanged");
  assert.equal(renderFfxivCardText("event",other),"");
  const summer={...other,end:Date.UTC(2027,5,1,7)};
  const [summerEmbed]=renderFfxivCardEmbeds("event",summer);
  assert.match(summerEmbed.description,/koniec: 1 czerwca 2027 09:00/,"summer DST is correct");
});
test("Source preview restoration preserves event message and history thread",async()=>{
  const guildId="911111111111111111",channelId="922222222222222222";
  const anchor="933333333333333333",thread="944444444444444444",content={
    id:"event",title:"FINAL FANTASY XIV x FINAL FANTASY XVI Crossover Event Returns!",
    url:source,end:Date.UTC(2026,11,9,14,59),
    image:"https://eu.finalfantasyxiv.com/images/crossover.jpg"};
  const key="ffxiv_board_v3_"+guildId+"_"+channelId+"_event";
  const state=new Map([[key,JSON.stringify({anchor,thread,current:content,renderRevision:11})]]);
  const DB={prepare:()=>({bind:(...args)=>({
    first:async()=>({value:state.get(args[0])??""}),
    run:async()=>{state.set(args[0],args[1]);return {meta:{changes:1}};}
  })})};
  let message={id:anchor,content:"Old verbose event content",embeds:[{title:"Old event",color:1}]};
  const requests=[],fetchOld=globalThis.fetch;
  globalThis.fetch=async(url,opts={})=>{
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    assert.equal(path,"channels/"+channelId+"/messages/"+anchor,
      "never POST another event or archive a history thread");
    const method=opts.method??"GET";
    requests.push(method);
    if(method==="PATCH"){
      const body=JSON.parse(opts.body);
      assert.equal(body.content,"","event post has no redundant link above embeds");
      assert.equal(body.embeds[0].url,source);
      assert.equal(body.embeds[0].title,"The Path Infernal • FFXIV × FFXVI");
      assert.deepEqual(body.embeds[0].image,{url:content.image});
      message={...message,content:body.content,embeds:body.embeds};
    }else assert.equal(method,"GET");
    return new Response(JSON.stringify(message),{
      status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const cfg={guildId,channelId,events:true,fashion:true,lodestone:true,dalamud:true};
    assert.deepEqual(await refreshFfxivEventCompact({DB,DISCORD_BOT_TOKEN:"test"},cfg),
      {checked:1,updated:1,verified:1,errors:[]});
    assert.deepEqual(requests,["GET","PATCH","GET"]);
    const saved=JSON.parse(state.get(key));
    assert.equal(saved.anchor,anchor);
    assert.equal(saved.thread,thread);
    assert.equal(saved.renderRevision,14);
    assert.equal(message.embeds[0].title,"The Path Infernal • FFXIV × FFXVI");
    assert.deepEqual(await refreshFfxivEventCompact({DB,DISCORD_BOT_TOKEN:"test"},cfg),
      {checked:1,updated:0,verified:1,errors:[]});
    assert.equal(requests.filter(x=>x==="PATCH").length,1,"no repeated updates");
  }finally{globalThis.fetch=fetchOld;}
});

test("All verified events render as separate official embeds, with no redundant text above them",()=>{
  const start=Date.now()-3*86400000;
  const now=Date.now();
  const entries=[
    {title:"The Path Infernal",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/aa11",
     date:start,start,end:now+2*86400000,image:"https://lds-img.finalfantasyxiv.com/aa11.png"},
    {title:"Starlight Celebration",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/bb22",
     date:start,start,end:now+3*86400000,image:"https://lds-img.finalfantasyxiv.com/bb22.png"},
    {title:"Heavensturn",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/cc33",
     date:start,start,end:now+4*86400000}
  ];
  const selected=activeEventSet(entries,null,now);
  assert.ok(selected);
  assert.equal(selected.otherEvents.length,2);
  assert.equal(renderFfxivCardText("event",selected),"");
  const cards=renderFfxivCardEmbeds("event",selected);
  assert.equal(cards.length,3,"every active event gets its own card");
  assert.deepEqual(cards.map(x=>x.url),entries.map(x=>x.url));
  assert.equal(cards[0].color,0xF5A544);
  assert.equal(cards[1].image.url,entries[1].image);
  assert.ok(cards[0].description.includes("koniec:"));
  const onlySecond=activeEventSet([],selected,now+2*86400000+1);
  assert.equal(renderFfxivCardEmbeds("event",onlySecond).length,2,
    "only ended event disappears at its deadline");
  const withExtra=activeEventSet([{
    title:"New event",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/dd44",
    date:now,start:now-1000,end:now+6*86400000
  }],selected,now);
  assert.equal(renderFfxivCardEmbeds("event",withExtra).length,4,
    "newly discovered events are added without hiding existing ones");
  const duplicated=activeEventSet([...entries,entries[0]],null,now);
  assert.equal(renderFfxivCardEmbeds("event",duplicated).length,3,
    "the same official event cannot appear twice");
});
test("More than ten verified active events remain visible in a linked summary embed",()=>{
  const now=Date.now();
  const items=Array.from({length:13},(_,i)=>({
    title:"Event "+i,url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/"+String(100+i),
    date:now,start:now-1000,end:now+(i+1)*86400000
  }));
  const current=activeEventSet(items,null,now);
  const cards=renderFfxivCardEmbeds("event",current);
  assert.equal(cards.length,10,"Discord limits each message to 10 rich embeds");
  assert.equal(cards[9].title,"Pozostałe aktywne wydarzenia");
  assert.ok(cards[9].description.includes("Event 12"));
  assert.equal(renderFfxivCardText("event",current),"");
});
test("Reconciliation preserves one existing event post, adds overlapping events and archives only expired ones",async()=>{
  const original=globalThis.fetch,now=Date.now();
  const guildId="911111111111111111",channelId="922222222222222222";
  const events=[
    {title:"Festival A",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/aa11",
      date:now-10000,start:now-10000,end:now+3600000},
    {title:"Festival B",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/bb22",
      date:now-10000,start:now-10000,end:now+7200000},
    {title:"Festival C",url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/cc33",
      date:now-10000,start:now-10000,end:now+10800000}
  ];
  const categories=["event","fashion","patch","dalamud"];
  const anchor=cat=>String(933333333333333330n+BigInt(categories.indexOf(cat)));
  const thread=cat=>String(944444444444444440n+BigInt(categories.indexOf(cat)));
  const cacheKey=cat=>"ffxiv_board_v3_"+guildId+"_"+channelId+"_"+cat;
  const store=new Map();
  for(const category of categories)
    store.set(cacheKey(category),JSON.stringify({anchor:anchor(category),thread:thread(category),
      current:null,renderRevision:14}));
  store.set("ffxiv_board_v3_cleanup_done_"+guildId+"_"+channelId,"1");
  for(const name of ["fashion","lodestone","dalamud"])
    store.set("ffxiv_board_v3_legacy_finished_"+channelId+"_"+name,"1");
  const DB={prepare:()=>({bind:(...args)=>({
    first:async()=>({value:store.get(args[0])??""}),
    run:async()=>{store.set(args[0],args[1]);return {meta:{changes:1}};}
  })})};
  const operations=[];
  globalThis.fetch=async(url,opts={})=>{
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    const method=opts.method??"GET";
    operations.push({method,path,body:opts.body});
    if(method==="GET" && path==="channels/"+thread("event"))
      return new Response(JSON.stringify({id:thread("event"),thread_metadata:{archived:false}}),{status:200});
    if(method==="POST" && path==="channels/"+thread("event")+"/messages")
      return new Response(JSON.stringify({id:"955555555555555555"}),{status:200});
    if(method==="PATCH" && path==="channels/"+channelId+"/messages/"+anchor("event")){
      const payload=JSON.parse(opts.body);
      return new Response(JSON.stringify({id:anchor("event"),content:payload.content,embeds:payload.embeds}),
        {status:200,headers:{"content-type":"application/json"}});
    }
    if(method==="GET" && path==="channels/"+channelId+"/messages/"+anchor("event"))
      return new Response(JSON.stringify({id:anchor("event")}),{status:200});
    throw new Error("Unexpected Discord call "+method+" "+path);
  };
  try{
    const cfg={guildId,channelId,events:true,fashion:true,lodestone:true,dalamud:true};
    const first=await updateFourPosts({DB,DISCORD_BOT_TOKEN:"test"},cfg,{events});
    assert.deepEqual(first.changes,["event"]);
    const initialPatch=operations.filter(x=>x.method==="PATCH");
    assert.equal(initialPatch.length,1);
    assert.equal(JSON.parse(initialPatch[0].body).embeds.length,3);
    assert.equal(JSON.parse(initialPatch[0].body).content,"");
    assert.equal(operations.filter(x=>x.method==="POST").length,0);
    const before=JSON.parse(store.get(cacheKey("event")));
    assert.equal(before.anchor,anchor("event"));
    assert.equal(before.thread,thread("event"));
    const same=await updateFourPosts({DB,DISCORD_BOT_TOKEN:"test"},cfg,{events});
    assert.equal(same.updated,0,"do not edit unchanged event sets");
    assert.equal(operations.filter(x=>x.method==="PATCH").length,1);
    const expired=await expireFourPosts({DB,DISCORD_BOT_TOKEN:"test"},cfg,now+3600001);
    assert.deepEqual(expired.expired,["event"]);
    assert.deepEqual(expired.errors,[]);
    const posts=operations.filter(x=>x.method==="POST");
    assert.equal(posts.length,1,"archive only the completed Festival A");
    assert.equal(JSON.parse(posts[0].body).embeds[0].url,events[0].url);
    const patches=operations.filter(x=>x.method==="PATCH");
    assert.equal(patches.length,2);
    assert.deepEqual(JSON.parse(patches[1].body).embeds.map(x=>x.url),
      [events[1].url,events[2].url]);
    const after=JSON.parse(store.get(cacheKey("event")));
    assert.equal(after.anchor,before.anchor);
    assert.equal(after.thread,before.thread);
    assert.equal(after.current.otherEvents.length,1);
  }finally{globalThis.fetch=original;}
});

test("Embed Links repair grants only the YURA Discord user, preserving existing bits",async()=>{
  const original=globalThis.fetch;
  const guildId="911111111111111111",channelId="922222222222222222",botId="933333333333333333";
  const cfg={guildId,channelId,events:true,fashion:true,lodestone:true,dalamud:true};
  const overwrites=[
    {id:guildId,type:0,allow:"0",deny:"1024"},
    {id:botId,type:1,allow:"32",deny:"16384"}
  ];
  let writes=0;
  globalThis.fetch=async (url,opts)=>{
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    if(opts.method==="GET"){
      const result=path==="users/@me"?{id:botId}:
        path==="channels/"+channelId?{guild_id:guildId,type:0,permission_overwrites:overwrites}:null;
      if(!result)throw Error("Unexpected read: "+path);
      return new Response(JSON.stringify(result),{status:200,
        headers:{"content-type":"application/json"}});
    }
    writes++;
    assert.equal(opts.method,"PUT");
    assert.equal(path,"channels/"+channelId+"/permissions/"+botId);
    const payload=JSON.parse(opts.body);
    assert.equal(payload.type,1);
    assert.equal(BigInt(payload.allow),32n|16384n);
    assert.equal(BigInt(payload.deny),0n);
    return new Response(null,{status:204});
  };
  try{
    assert.equal(await ensureFfxivEmbedLinks({DISCORD_BOT_TOKEN:"test"},cfg),"enabled-for-yura-only");
    assert.equal(writes,1);
  }finally{globalThis.fetch=original;}
});

test("Every FFXIV news category is visually distinct with the intended Discord stripe",()=>{
  const colors={event:0xF5A544,fashion:0xD976BD,patch:0x5CA9F5,dalamud:0x43C6A2};
  for(const [category,item] of cases){
    const [e]=renderFfxivCardEmbeds(category,item);
    assert.equal(e.color,colors[category],category+" must have a colored embed");
    assert.equal(e.url,category==="fashion"?"https://fashionreportxiv.com/":item.url);
  }
  assert.equal(new Set(Object.values(colors)).size,4);
});
test("In-place color migration preserves all anchors, thread IDs and the attached Fashion image",async()=>{
  const guildId="911111111111111111",channelId="922222222222222222";
  const stored=new Map(),messages=new Map(),original=globalThis.fetch;
  const files={id:"988888888888888888",filename:"fashion-report.png"};
  const anchor=i=>String(933333333333333330n+BigInt(i));
  for(let i=0;i<cases.length;i++){
    const [cat,item]=cases[i];
    stored.set("ffxiv_board_v3_"+guildId+"_"+channelId+"_"+cat,
      JSON.stringify({anchor:anchor(i),thread:String(944444444444444440n+BigInt(i)),current:item,renderRevision:10}));
    messages.set(anchor(i),{id:anchor(i),content:"old",embeds:[{title:"Old",color:1}],
      attachments:cat==="fashion"?[files]:[]});
  }
  const DB={prepare:()=>({bind:(...args)=>({
    first:async()=>({value:stored.get(args[0])??""}),
    run:async()=>{stored.set(args[0],args[1]);return {meta:{changes:1}};}
  })})};
  const writes=[];
  globalThis.fetch=async(url,opts={})=>{
    const id=new URL(String(url)).pathname.split("/").at(-1);
    const method=opts.method??"GET";
    if(!messages.has(id))throw Error("Unexpected message request "+id);
    if(method==="GET")return new Response(JSON.stringify(messages.get(id)),{status:200,
      headers:{"content-type":"application/json"}});
    assert.equal(method,"PATCH","must never create a new message or history");
    writes.push(id);
    assert.equal(typeof opts.body,"string","no Fashion image reupload");
    const body=JSON.parse(opts.body),prior=messages.get(id);
    if(id===anchor(1)){
      assert.deepEqual(body.attachments,[files]);
      assert.equal(body.embeds[0].image.url,"attachment://fashion-report.png");
    }
    messages.set(id,{...prior,content:body.content,embeds:body.embeds});
    return new Response(JSON.stringify(messages.get(id)),{status:200,
      headers:{"content-type":"application/json"}});
  };
  try{
    const cfg={guildId,channelId,events:true,fashion:true,lodestone:true,dalamud:true};
    const result=await refreshFfxivCardPalette({DB,DISCORD_BOT_TOKEN:"test"},cfg);
    assert.deepEqual(result,{checked:4,updated:4,verified:4,errors:[]});
    assert.equal(writes.length,4);
    for(let i=0;i<cases.length;i++){
      const cat=cases[i][0],saved=JSON.parse(stored.get("ffxiv_board_v3_"+guildId+"_"+channelId+"_"+cat));
      assert.equal(saved.anchor,anchor(i));
      assert.equal(saved.thread,String(944444444444444440n+BigInt(i)));
      assert.equal(saved.renderRevision,14);
      assert.equal(messages.get(anchor(i)).embeds[0].color,FFXIV_CARD_PALETTE[cat].color);
    }
    assert.deepEqual(messages.get(anchor(1)).attachments,[files]);
    assert.deepEqual(await refreshFfxivCardPalette({DB,DISCORD_BOT_TOKEN:"test"},cfg),
      {checked:4,updated:0,verified:4,errors:[]});
    assert.equal(writes.length,4,"must not rewrite unchanged posts");
  }finally{globalThis.fetch=original;}
});

test("Dalamud retains a readable text fallback outside the embed",()=>{
  for(const [category,item,parts] of cases.filter(([cat])=>cat==="dalamud")){
    const content=renderFfxivCardText(category,item);
    assert.ok(content.startsWith(FFXIV_CARD_PALETTE[category].marker+" **"));
    for(const part of parts)assert.ok(content.includes(part),category+": missing "+part);
    assert.match(content,/\]\(https:\/\//,category+" must contain a clickable link");
    assert.ok(content.length>50,"card is merely a header: "+category);
  }
});
test("Official Patch 7.58 hero art is selected without unrelated image links",()=>{
  const id="b5a3ecf6c8e56e3f669681a077bf6d389dce10bd";
  const article="https://eu.finalfantasyxiv.com/lodestone/topics/detail/"+id;
  const image="https://img.finalfantasyxiv.com/t/"+id+".jpg?1794219335=";
  const html='<img src="https://img.finalfantasyxiv.com/t/ffffffffffffffffffffffffffffffffffffffff.jpg">'+
    '<a href="//img.finalfantasyxiv.com/t/'+id+'.jpg?1794219335=">Banner</a>';
  assert.equal(extractOfficialPatchHero(html,article),image);
  assert.equal(extractOfficialPatchHero(html,article.replace("eu.","evil.")),null);
  assert.equal(extractOfficialPatchHero(html.replace(id,"ffffffffffffffffffffffffffffffffffffffff"),article),null);
  const patch=cases.find(([category])=>category==="patch")[1];
  assert.deepEqual(renderFfxivCardEmbeds("patch",{...patch,image})[0].image,{url:image});
  assert.equal(renderFfxivCardEmbeds("patch",{...patch,image})[0].url,source,
    "the embed title must still link to the official patch notes");
  assert.equal(renderFfxivCardEmbeds("patch",{...patch,
    image:"https://cdn.discordapp.com/attachments/123/something.jpg"})[0].image,undefined,
    "reject non-official article banner origins");
});
test("Adding official hero updates existing Patch embed without archiving the same patch",async()=>{
  const guildId="911111111111111111",channelId="922222222222222222",
    anchor="933333333333333333",thread="944444444444444444";
  const articleId="b5a3ecf6c8e56e3f669681a077bf6d389dce10bd";
  const banner="https://img.finalfantasyxiv.com/t/"+articleId+".jpg?1794219335=";
  const current={id:"7.58",title:"Patch 7.58 Notes",
    url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/"+articleId};
  const key="ffxiv_board_v3_"+guildId+"_"+channelId+"_patch";
  const stored=new Map([[key,JSON.stringify({anchor,thread,current,renderRevision:14})]]);
  const DB={prepare:()=>({bind:(...args)=>({
    first:async()=>({value:stored.get(args[0])??""}),
    run:async()=>{stored.set(args[0],args[1]);return {meta:{changes:1}};}
  })})};
  const oldFetch=globalThis.fetch, requests=[];
  let message={id:anchor,content:"",embeds:[{title:"Patch 7.58 Notes",url:current.url,
    description:"Oficjalne informacje o aktualizacji FFXIV.",color:0x5CA9F5}]};
  globalThis.fetch=async(url,opts={})=>{
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    const method=opts.method??"GET";
    requests.push({path,method});
    assert.equal(path,"channels/"+channelId+"/messages/"+anchor,
      "no new post or history thread write");
    if(method==="PATCH"){
      const body=JSON.parse(opts.body);
      assert.equal(body.content,"");
      assert.equal(body.embeds[0].url,current.url);
      assert.equal(body.embeds[0].color,0x5CA9F5);
      assert.deepEqual(body.embeds[0].image,{url:banner});
      message={...message,content:body.content,embeds:body.embeds};
    }
    return new Response(JSON.stringify(message),{status:200,
      headers:{"content-type":"application/json"}});
  };
  try{
    const cfg={guildId,channelId,lodestone:true,events:true,fashion:true,dalamud:true};
    assert.deepEqual(await refreshFfxivPatchBanner({DB,DISCORD_BOT_TOKEN:"test"},cfg,banner),
      {checked:1,updated:1,verified:1,errors:[]});
    assert.deepEqual(requests.map(x=>x.method),["PATCH","GET"]);
    const saved=JSON.parse(stored.get(key));
    assert.equal(saved.anchor,anchor);
    assert.equal(saved.thread,thread);
    assert.equal(saved.current.image,banner);
    assert.deepEqual(await refreshFfxivPatchBanner({DB,DISCORD_BOT_TOKEN:"test"},cfg,banner),
      {checked:1,updated:0,verified:1,errors:[]},"idempotent");
    assert.equal(requests.filter(x=>x.method==="PATCH").length,1,"no duplicate updates");
  }finally{globalThis.fetch=oldFetch;}
});
test("Published Patch uses only its blue official Lodestone embed",()=>{
  const current=cases.find(([category])=>category==="patch")[1];
  assert.equal(renderFfxivCardText("patch",current),"",
    "no redundant status line, title or Read Patch Notes link above embed");
  const cards=renderFfxivCardEmbeds("patch",current);
  assert.equal(cards.length,1);
  assert.equal(cards[0].title,"Patch 7.58 Notes");
  assert.equal(cards[0].url,source,"clicking the blue title opens the official notes");
  assert.equal(cards[0].color,0x5CA9F5,"blue Patch category styling preserved");
  assert.equal(cards[0].description,"Oficjalne informacje o aktualizacji FFXIV.");
  assert.match(renderFfxivCardText("patch",null),/Czekamy na oficjalne patch notes/,
    "keep explanatory placeholder when there is no confirmed patch");
});
test("Patch cleanup updates the existing Discord post only, preserving its thread",async()=>{
  const guildId="911111111111111111",channelId="922222222222222222";
  const anchorId="933333333333333333",threadId="944444444444444444";
  const current={id:"7.58",title:"Patch 7.58 Notes",url:source};
  const key="ffxiv_board_v3_"+guildId+"_"+channelId+"_patch";
  const stored=new Map([[key,JSON.stringify({
    anchor:anchorId,thread:threadId,current,renderRevision:14
  })]]);
  const DB={prepare:()=>({bind:(...args)=>({
    first:async()=>({value:stored.get(args[0])??""}),
    run:async()=>{stored.set(args[0],args[1]);return {meta:{changes:1}};}
  })})};
  let message={id:anchorId,content:"Old duplicated header",embeds:[{
    title:"Patch 7.58 Notes",url:source,color:0x5CA9F5,
    description:"Oficjalne informacje o aktualizacji FFXIV."
  }]};
  const old=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,opts={})=>{
    const method=opts.method??"GET";
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    requests.push(method);
    assert.equal(path,"channels/"+channelId+"/messages/"+anchorId,
      "must only operate on the saved Patch message, not create new posts");
    if(method==="PATCH"){
      const payload=JSON.parse(opts.body);
      assert.equal(payload.content,"","clean content only");
      assert.equal(payload.embeds.length,1);
      assert.equal(payload.embeds[0].title,"Patch 7.58 Notes");
      assert.equal(payload.embeds[0].url,source);
      assert.equal(payload.embeds[0].color,0x5CA9F5);
      assert.deepEqual(payload.allowed_mentions,{parse:[]});
      message={...message,content:payload.content,embeds:payload.embeds};
    }else assert.equal(method,"GET");
    return new Response(JSON.stringify(message),{
      status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const cfg={guildId,channelId,events:true,fashion:true,lodestone:true,dalamud:true};
    assert.deepEqual(await refreshFfxivPatchEmbedOnly({DB,DISCORD_BOT_TOKEN:"test"},cfg),
      {checked:1,updated:1,verified:1,errors:[]});
    assert.deepEqual(requests,["GET","PATCH","GET"]);
    assert.equal(JSON.parse(stored.get(key)).anchor,anchorId,"anchor preserved");
    assert.equal(JSON.parse(stored.get(key)).thread,threadId,"history thread preserved");
    assert.deepEqual(await refreshFfxivPatchEmbedOnly({DB,DISCORD_BOT_TOKEN:"test"},cfg),
      {checked:1,updated:0,verified:1,errors:[]});
    assert.deepEqual(requests,["GET","PATCH","GET","GET"],"repeat is read-only");
    assert.equal(requests.filter(x=>x==="POST").length,0);
  }finally{globalThis.fetch=old;}
});
test("Expired cards show an explanatory text even with embeds disabled",()=>{
  for(const category of ["event","fashion","patch","dalamud"]){
    const content=renderFfxivCardText(category,null);
    assert.ok(content.split("\n").length>1);
    assert.ok(content.length>32);
  }
});

test("Fashion reset is a clickable embed title, never raw Markdown in content",()=>{
  const reportData=cases[1][1];
  assert.equal(renderFfxivCardText("fashion",reportData),"");
  const [embed]=renderFfxivCardEmbeds("fashion",reportData);
  assert.equal(embed.title,"👗 Reset: 24 listopada 2026 09:00");
  assert.equal(embed.url,"https://fashionreportxiv.com/");
  assert.equal(embed.description,undefined);
  assert.equal(embed.footer,undefined);
  assert.equal(embed.color,0xD976BD);
  assert.ok(!/80\/100|MGP|Grafika tygodnia poniżej/i.test(JSON.stringify(embed)));
  // Poland daylight saving time must also be correct in the summer.
  const [summer]=renderFfxivCardEmbeds("fashion",{...reportData,
    expires:Date.UTC(2027,5,1,7)});
  assert.equal(summer.title,"👗 Reset: 1 czerwca 2027 09:00");
});
test("Fashion Report is uploaded as native Discord image attachment",async()=>{
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,opts)=>{
    calls.push({url:String(url),opts});
    if(String(url).startsWith("https://cdn.discordapp.com/")){
      assert.equal(opts.redirect,"manual","Workers do not support redirect:error");
    }
    if(String(url).startsWith("https://cdn.discordapp.com/"))
      return new Response(new Uint8Array(30000),{status:200,headers:{"content-type":"image/png","content-length":"30000"}});
    assert.ok(opts.body instanceof FormData,"Discord must receive multipart form data");
    const data=JSON.parse(String(opts.body.get("payload_json")));
    assert.equal(data.content,"","no raw Markdown in bot message body");
    assert.equal(data.attachments[0].filename,"fashion-report.png");
    assert.equal(data.embeds.length,1);
    assert.equal(data.embeds[0].title,"👗 Reset: 24 listopada 2026 09:00");
    assert.equal(data.embeds[0].url,"https://fashionreportxiv.com/");
    assert.equal(data.embeds[0].image.url,"attachment://fashion-report.png");
    assert.ok(opts.body.get("files[0]") instanceof Blob);
    assert.equal(opts.headers["content-type"],undefined,"boundary must be added by fetch");
    return new Response(JSON.stringify({id:"123456789012345678",attachments:[{id:"999999999999999999",filename:"fashion-report.png"}]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const warnings=[];
    const ok=await deliverCard({DISCORD_BOT_TOKEN:"test"},"channels/111111111111111111/messages/222222222222222222",
      "PATCH","fashion",cases[1][1],warnings);
    assert.equal(ok,true);
    assert.equal(warnings.length,0);
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=original;}
});
test("Existing Fashion attachment is preserved inside the clickable embed without re-upload",async()=>{
  const old=globalThis.fetch;
  let patches=0;
  globalThis.fetch=async(url,opts)=>{
    patches++;
    assert.equal(opts.method,"PATCH");
    assert.ok(typeof opts.body==="string","no multipart re-upload");
    const payload=JSON.parse(opts.body);
    assert.equal(payload.content,"");
    assert.equal(payload.embeds.length,1);
    assert.equal(payload.embeds[0].title,"👗 Reset: 24 listopada 2026 09:00");
    assert.equal(payload.embeds[0].url,"https://fashionreportxiv.com/");
    assert.equal(payload.embeds[0].image.url,"attachment://fashion-report.png");
    assert.equal(payload.attachments.length,1);
    assert.equal(payload.attachments[0].id,"999999999999999999");
    return new Response(JSON.stringify({id:"222222222222222222"}),{status:200,
      headers:{"content-type":"application/json"}});
  };
  try{
    const warnings=[];
    const ok=await deliverCard({DISCORD_BOT_TOKEN:"test"},
      "channels/111111111111111111/messages/222222222222222222",
      "PATCH","fashion",cases[1][1],warnings,
      {attachments:[{id:"999999999999999999",filename:"fashion-report.png"}]});
    assert.equal(ok,true);
    assert.equal(patches,1);
    assert.deepEqual(warnings,[]);
  }finally{globalThis.fetch=old;}
});
test("Cloudflare CDN 403 falls back to this week's publisher art and posts an inline attachment",async()=>{
  const original=globalThis.fetch;
  let calls=0,uploaded=false;
  const publisherLastModified=new Date(Date.UTC(2026,10,20,10)).toUTCString();
  globalThis.fetch=async(url,opts)=>{
    calls++;
    const target=String(url);
    if(target.startsWith("https://cdn.discordapp.com/") ||
       target.startsWith("https://fashionreportxiv.com/"))
      assert.equal(opts.redirect,"manual","Cloudflare Worker only accepts manual/follow");
    if(target.startsWith("https://cdn.discordapp.com/"))
      return new Response("Forbidden",{status:403});
    if(target==="https://fashionreportxiv.com/hint.png")
      return new Response(new Uint8Array(32000),{status:200,
        headers:{"content-type":"image/png","last-modified":publisherLastModified}});
    assert.ok(target.startsWith("https://discord.com/api/v10/"));
    assert.ok(opts.body instanceof FormData);
    uploaded=true;
    const payload=JSON.parse(opts.body.get("payload_json"));
    assert.equal(payload.content,"");
    assert.equal(payload.embeds[0].title,"👗 Reset: 24 listopada 2026 09:00");
    assert.equal(payload.embeds[0].image.url,"attachment://fashion-report.png");
    assert.equal(payload.attachments[0].filename,"fashion-report.png");
    return new Response(JSON.stringify({attachments:[{id:"777777777777777777",filename:"fashion-report.png"}]}),
      {status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const warnings=[];
    const ok=await deliverCard({DISCORD_BOT_TOKEN:"test",DB:backupDb().DB},
      "channels/777777777777777777/messages/888888888888888888",
      "PATCH","fashion",cases[1][1],warnings);
    assert.equal(ok,true);
    assert.equal(warnings.length,0);
    assert.equal(uploaded,true);
    assert.equal(calls,3);
  }finally{globalThis.fetch=original;}
});
test("Publisher backup follows only approved https redirects in Cloudflare Workers",async()=>{
  const original=globalThis.fetch;
  const {DB}=backupDb();
  let redirectCount=0;
  globalThis.fetch=async(url,opts)=>{
    const target=String(url);
    if(target.startsWith("https://cdn.discordapp.com/"))
      return new Response("403",{status:403});
    if(target==="https://fashionreportxiv.com/hint.png"){
      assert.equal(opts.redirect,"manual");
      redirectCount++;
      return new Response(null,{status:302,
        headers:{location:"https://www.fashionreportxiv.com/hint.png"}});
    }
    if(target==="https://www.fashionreportxiv.com/hint.png"){
      assert.equal(opts.redirect,"manual");
      return new Response(new Uint8Array(36000),{
        status:200,headers:{"content-type":"image/png"}});
    }
    assert.ok(opts.body instanceof FormData);
    return new Response(JSON.stringify({attachments:[{id:"888888888888888888",filename:"fashion-report.png"}]}),
      {status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const warnings=[];
    assert.equal(await deliverCard({DISCORD_BOT_TOKEN:"test",DB},
      "channels/777777777777777777/messages/888888888888888888",
      "PATCH","fashion",cases[1][1],warnings),true);
    assert.equal(redirectCount,1);
    assert.deepEqual(warnings,[]);
  }finally{globalThis.fetch=original;}
});
test("Week 460 publisher backup succeeds without Last-Modified when source week is proven",async()=>{
  const original=globalThis.fetch;
  const {DB,store}=backupDb();
  let delivered=0;
  globalThis.fetch=async (url,opts)=>{
    const target=String(url);
    if(target.startsWith("https://cdn.discordapp.com/"))
      return new Response("Forbidden",{status:403});
    if(target==="https://fashionreportxiv.com/hint.png")
      return new Response(new Uint8Array(36000),{status:200,
        headers:{"content-type":"image/png"}});
    if(target.startsWith("https://discord.com/api/v10/")) {
      delivered++;
      assert.ok(opts.body instanceof FormData);
      return new Response(JSON.stringify({attachments:[{id:"777777777777777777",filename:"fashion-report.png"}]}),
        {status:200,headers:{"content-type":"application/json"}});
    }
    throw Error("Unknown URL "+target);
  };
  try{
    const warnings=[];
    const ok=await deliverCard({DISCORD_BOT_TOKEN:"test",DB},
      "channels/777777777777777777/messages/888888888888888888",
      "PATCH","fashion",cases[1][1],warnings);
    assert.equal(ok,true);
    assert.deepEqual(warnings,[]);
    assert.equal(delivered,1);
    assert.ok(String(store.get("ffxiv_fashion_media_status_v1")).startsWith("OK"));
    const record=JSON.parse(store.get("ffxiv_fashion_publisher_backup_last_v1"));
    assert.equal(record.week,460);
  }finally{globalThis.fetch=original;}
});
test("Discord media proxy can rescue an image when primary CDN returns 403",async()=>{
  const original=globalThis.fetch;
  const data={...cases[1][1],
    imageProxy:"https://media.discordapp.net/attachments/111111111111111111/222222222222222222/report.png?ex=1234"};
  let primary=0,proxy=0,post=0;
  globalThis.fetch=async(url,opts)=>{
    const u=String(url);
    if(u.startsWith("https://cdn.discordapp.com/")) {
      primary++;return new Response("Forbidden",{status:403});
    }
    if(u.startsWith("https://media.discordapp.net/")){
      proxy++;return new Response(new Uint8Array(30000),{status:200,
        headers:{"content-type":"image/png"}});
    }
    if(u.startsWith("https://discord.com/api/")){
      post++;assert.ok(opts.body instanceof FormData);
      return new Response(JSON.stringify({attachments:[{id:"999999999999999999",filename:"fashion-report.png"}]}),
        {status:200,headers:{"content-type":"application/json"}});
    }
    throw Error("Unexpected "+u);
  };
  try{
    const warnings=[];
    const ok=await deliverCard({DISCORD_BOT_TOKEN:"test"},
      "channels/777777777777777777/messages/888888888888888888",
      "PATCH","fashion",data,warnings);
    assert.equal(ok,true);
    assert.equal(warnings.length,0);
    assert.deepEqual([primary,proxy,post],[1,1,1]);
  }finally{globalThis.fetch=original;}
});
test("Fashion public title never reveals the private moderators' source message",()=>{
  const text=renderFfxivCardText("fashion",cases[1][1]);
  const [embed]=renderFfxivCardEmbeds("fashion",cases[1][1]);
  assert.equal(text,"");
  assert.equal(embed.url,"https://fashionreportxiv.com/");
  assert.ok(!JSON.stringify(embed).includes("discord.com/channels/111/222/333"),
    "no private source-message links");
});
test("If source image is unavailable, Fashion message still displays all information",async()=>{
  const original=globalThis.fetch;
  let payload=null;
  globalThis.fetch=async(url,opts)=>{
    if(String(url).startsWith("https://cdn.discordapp.com/"))
      throw new Error("CDN unavailable");
    payload=JSON.parse(String(opts.body));
    return new Response(JSON.stringify({id:"123456789012345678",embeds:[]}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const warnings=[];
    const ok=await deliverCard({DISCORD_BOT_TOKEN:"test"},"channels/333333333333333333/messages/444444444444444444",
      "PATCH","fashion",cases[1][1],warnings);
    assert.equal(ok,false);
    assert.equal(payload.content,"");
    assert.equal(payload.embeds[0].title,"👗 Reset: 24 listopada 2026 09:00");
    assert.equal(payload.embeds[0].url,"https://fashionreportxiv.com/");
    assert.equal(warnings.length,1);
  }finally{globalThis.fetch=original;}
});

test("existing blank Fashion card is repaired in-place after source cursor was already consumed",async()=>{
  const originalFetch=globalThis.fetch;
  const guildId="911111111111111111",channelId="922222222222222222";
  const categories=["event","fashion","patch","dalamud"];
  const refs=Object.fromEntries(categories.map((name,i)=>
    [name,{anchor:String(933333333333333330n+BigInt(i)),thread:String(944444444444444440n+BigInt(i))}]));
  const fashionCurrent={
    id:"discord-fashion-week-460",title:"Fashion Report • Week 460",
    url:"https://discord.com/channels/"+guildId+"/955555555555555555/966666666666666666",
    image:report,expires:Date.now()+86400000
  };
  const meta=new Map();
  for(const name of categories){
    const state={...refs[name],current:name==="fashion"?fashionCurrent:null,renderRevision:name==="fashion"?13:14};
    meta.set("ffxiv_board_v3_"+guildId+"_"+channelId+"_"+name,JSON.stringify(state));
  }
  meta.set("ffxiv_board_v3_cleanup_done_"+guildId+"_"+channelId,"1");
  for(const name of ["fashion","lodestone","dalamud"])
    meta.set("ffxiv_board_v3_legacy_finished_"+channelId+"_"+name,"1");
  const db={
    prepare:()=>({bind:(...args)=>({
      first:async()=>({value:meta.get(args[0])||""}),
      run:async()=>{meta.set(args[0],args[1]);return {meta:{changes:1}}}
    })})
  };
  const calls=[];
  globalThis.fetch=async(url,opts={})=>{
    const target=String(url);
    calls.push({target,method:opts.method});
    if(target.startsWith("https://cdn.discordapp.com/"))
      return new Response(new Uint8Array(30000),{status:200,headers:{"content-type":"image/png"}});
    const path=new URL(target).pathname;
    if(opts.method==="GET" && path.endsWith("/messages/"+refs.fashion.anchor))
      return new Response(JSON.stringify({id:refs.fashion.anchor,content:"**👗 FASHION REPORT**",
        embeds:[],attachments:[]}),{status:200});
    if(opts.method==="PATCH" && path.endsWith("/messages/"+refs.fashion.anchor)){
      assert.ok(opts.body instanceof FormData);
      const body=JSON.parse(opts.body.get("payload_json"));
      assert.equal(body.content,"");
      assert.match(body.embeds[0].title,/👗 Reset:/);
      assert.equal(body.embeds[0].image.url,"attachment://fashion-report.png");
      return new Response(JSON.stringify({id:refs.fashion.anchor,
        attachments:[{id:"977777777777777777",filename:"fashion-report.png"}]}),
        {status:200,headers:{"content-type":"application/json"}});
    }
    throw Error("Unexpected "+(opts.method||"GET")+" "+target);
  };
  try{
    const cfg={guildId,channelId,events:true,fashion:true,lodestone:true,dalamud:true};
    // No fresh source items! The active report was already stored earlier.
    const result=await updateFourPosts({DISCORD_BOT_TOKEN:"test",DB:db},cfg,{events:null});
    assert.deepEqual(result.changes,["fashion"]);
    assert.deepEqual(result.errors,[]);
    assert.equal(result.updated,1);
    assert.equal(calls.filter(c=>c.method==="PATCH").length,1);
    assert.equal(calls.filter(c=>c.method==="POST").length,0,"must not create another Discord message");
    const repaired=JSON.parse(meta.get("ffxiv_board_v3_"+guildId+"_"+channelId+"_fashion"));
    assert.equal(repaired.current.id,"discord-fashion-week-460");
    assert.equal(repaired.renderRevision,14);
  }finally{globalThis.fetch=originalFetch;}
});
