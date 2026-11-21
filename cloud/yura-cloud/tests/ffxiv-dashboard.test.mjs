import test from "node:test";
import assert from "node:assert/strict";
import {renderFfxivCardText,deliverCard} from "../src/ffxiv-dashboard.ts";

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
