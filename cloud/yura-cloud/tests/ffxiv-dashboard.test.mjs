import test from "node:test";
import assert from "node:assert/strict";
import {renderFfxivCardText,renderFfxivCardEmbeds,deliverCard,updateFourPosts,refreshFfxivCardPalette,FFXIV_CARD_PALETTE} from "../src/ffxiv-dashboard.ts";

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
      assert.equal(saved.renderRevision,11);
      assert.equal(messages.get(anchor(i)).embeds[0].color,FFXIV_CARD_PALETTE[cat].color);
    }
    assert.deepEqual(messages.get(anchor(1)).attachments,[files]);
    assert.deepEqual(await refreshFfxivCardPalette({DB,DISCORD_BOT_TOKEN:"test"},cfg),
      {checked:4,updated:0,verified:4,errors:[]});
    assert.equal(writes.length,4,"must not rewrite unchanged posts");
  }finally{globalThis.fetch=original;}
});

test("Four active cards contain readable descriptions and clickable sources without embeds",()=>{
  for(const [category,item,parts] of cases.filter(([cat])=>cat!=="fashion")){
    const content=renderFfxivCardText(category,item);
    assert.ok(content.startsWith(FFXIV_CARD_PALETTE[category].marker+" **"));
    for(const part of parts)assert.ok(content.includes(part),category+": missing "+part);
    assert.match(content,/\]\(https:\/\//,category+" must contain a clickable link");
    assert.ok(content.length>50,"card is merely a header: "+category);
  }
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
    const state={...refs[name],current:name==="fashion"?fashionCurrent:null,renderRevision:name==="fashion"?10:11};
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
    assert.equal(repaired.renderRevision,11);
  }finally{globalThis.fetch=originalFetch;}
});
