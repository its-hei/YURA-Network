import test from "node:test";
import assert from "node:assert/strict";
import {isSelfRoleChannel,validateSelfRoles,selfRolePanelPayload,handleSelfRoleClick,ensureSelfRoleBotChannelPermission} from "../src/discord-self-roles.ts";

const guild="111111111111111111",xiv="222222222222222222",gamba="333333333333333333",
  fc="444444444444444444",bot="555555555555555555";
const roles=[
  {id:guild,name:"@everyone",position:0,permissions:"0"},
  {id:xiv,name:"XIV",position:1,permissions:"0"},
  {id:gamba,name:"Gamba",position:1,permissions:"0"},
  {id:fc,name:"FC",position:1,permissions:"0"},
  {id:bot,name:"Y.U.R.A.",position:8,permissions:"268435456"}
];
test("recognizes the decorated #role channel, not unrelated channels",()=>{
  assert.equal(isSelfRoleChannel("🎭・role"),true);
  assert.equal(isSelfRoleChannel("🔗 • role"),true);
  assert.equal(isSelfRoleChannel("role"),true);
  assert.equal(isSelfRoleChannel("roles"),false);
  assert.equal(isSelfRoleChannel("role-archive"),false);
});
test("validates only distinct low-privilege self-roles",()=>{
  const valid=[{id:xiv,label:"XIV"},{id:gamba,label:"Gamba"}];
  assert.deepEqual(validateSelfRoles(valid,roles,8,guild),valid);
  assert.throws(()=>validateSelfRoles([{id:fc,label:"FC"}],roles,8,guild),/protected/);
  assert.throws(()=>validateSelfRoles([valid[0],valid[0]],roles,8,guild),/duplicated/);
  assert.throws(()=>validateSelfRoles([{id:bot,label:"Bot"}],roles,8,guild),/below YURA/);
  assert.throws(()=>validateSelfRoles([{id:xiv,label:"two\nlines"}],roles,8,guild),/label/);
});
test("panel has real Discord buttons and no mention injections",()=>{
  const p=selfRolePanelPayload({roles:[{id:xiv,label:"XIV"},{id:gamba,label:"Gamba"}]});
  assert.equal(p.components.length,1);
  assert.equal(p.components[0].components[0].custom_id,"yura:self:"+xiv);
  assert.equal(p.components[0].components[1].custom_id,"yura:self:"+gamba);
  assert.deepEqual(p.allowed_mentions,{parse:[]});
});
test("stale or unrelated button cannot mutate Discord roles",async()=>{
  const old=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error("Should not call Discord");};
  const db={prepare:()=>({bind:()=>({first:async()=>({value:JSON.stringify({
    revision:0,guild_id:guild,channel_id:"666666666666666666",
    message_id:"777777777777777777",roles:[{id:xiv,label:"XIV"}]
  })})})})};
  const ctx={waitUntil:()=>{throw Error("No job on failed validation");}};
  try{
    const res=await handleSelfRoleClick({DB:db},ctx,{
      type:3,guild_id:guild,channel_id:"666666666666666666",
      message:{id:"888888888888888888"},member:{user:{id:"999999999999999999"}},
      data:{custom_id:"yura:self:"+xiv}
    });
    const data=await res.json();
    assert.equal(data.type,4);
    assert.equal(calls,0);
  }finally{globalThis.fetch=old;}
});

test("HTTP 403 remediation is a narrowly scoped bot-only channel overwrite",async()=>{
  const old=globalThis.fetch;
  const channel="666666666666666666";
  let changes=0;
  globalThis.fetch=async(url,opts)=>{
    const path=new URL(url).pathname.replace("/api/v10/","");
    if(opts.method==="GET"){
      const item=path==="users/@me"?{id:bot}:
        path==="channels/"+channel?{guild_id:guild,type:0,permission_overwrites:[
          {id:guild,type:0,allow:"0",deny:"1024"},
          {id:bot,type:1,allow:"32",deny:"1024"}
        ]}:null;
      if(!item)throw Error("Unexpected GET "+path);
      return new Response(JSON.stringify(item),{status:200,headers:{"content-type":"application/json"}});
    }
    assert.equal(path,"channels/"+channel+"/permissions/"+bot);
    assert.equal(opts.method,"PUT");
    const p=JSON.parse(opts.body);
    assert.equal(p.type,1);
    assert.equal((BigInt(p.allow)&32n)!==0n,true,"preserves unrelated bits");
    assert.equal((BigInt(p.allow)&1024n)!==0n,true,"bot can view");
    assert.equal((BigInt(p.allow)&2048n)!==0n,true,"bot can send messages");
    assert.equal((BigInt(p.allow)&16384n)!==0n,true,"bot can embed links");
    assert.equal((BigInt(p.deny)&1024n)===0n,true,"removes bot view deny");
    changes++;
    return new Response(null,{status:204});
  };
  try{
    await ensureSelfRoleBotChannelPermission({DISCORD_BOT_TOKEN:"test"},guild,channel);
    assert.equal(changes,1);
  }finally{globalThis.fetch=old;}
});
