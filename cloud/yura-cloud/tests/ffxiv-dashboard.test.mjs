import test from "node:test";
import assert from "node:assert/strict";
import {renderFfxivCardText,deliverCard,updateFourPosts} from "../src/ffxiv-dashboard.ts";

const source="https://eu.finalfantasyxiv.com/lodestone/topics/detail/abc123";
const report="https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/report.png?ex=1234";
const cases=[
  ["event",{id:"thepath",title:"The Path Infernal",url:source,end:Date.UTC(2026,11,9,14,59)},["The Path Infernal","Koniec:","Szczegóły wydarzenia"]],
  ["fashion",{id:"discord-fashion-week-460",title:"Week 460",url:"https://discord.com/channels/111/222/333",image:report,expires:Date.UTC(2026,10,24,8)},["80/100","60 000 MGP","Fashion Report • źródło"]],
  ["patch",{id:"7.58",title:"Patch 7.58 Notes",url:source},["Patch 7.58 Notes","Przeczytaj patch notes"]],
  ["dalamud",{id:"stable",title:"Dalamud Stable 15.0.4.1",url:"https://github.com/goatcorp/dalamud-distrib"},["Dalamud Stable 15.0.4.1","Wersja stabilna"]]
];

test("Four active cards contain readable descriptions and clickable sources without embeds",()=>{
  for(const [category,item,parts] of cases){
    const content=renderFfxivCardText(category,item);
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
test("Fashion Report is uploaded as native Discord image attachment",async()=>{
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,opts)=>{
    calls.push({url:String(url),opts});
    if(String(url).startsWith("https://cdn.discordapp.com/"))
      return new Response(new Uint8Array(30000),{status:200,headers:{"content-type":"image/png","content-length":"30000"}});
    assert.ok(opts.body instanceof FormData,"Discord must receive multipart form data");
    const data=JSON.parse(String(opts.body.get("payload_json")));
    assert.ok(data.content.includes("60 000 MGP"));
    assert.equal(data.attachments[0].filename,"fashion-report.png");
    assert.equal(data.embeds[0].image,undefined,"native image must not be hidden inside an embed");
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
    assert.match(payload.content,/60 000 MGP/);
    assert.match(payload.content,/Fashion Report • źródło/);
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
    const state={...refs[name],current:name==="fashion"?fashionCurrent:null,renderRevision:name==="fashion"?3:4};
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
      assert.match(body.content,/60 000 MGP/);
      assert.ok(!body.content.startsWith("**👗 FASHION REPORT**\n_"));
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
    assert.equal(repaired.renderRevision,4);
  }finally{globalThis.fetch=originalFetch;}
});
