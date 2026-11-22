import test from "node:test";
import assert from "node:assert/strict";
import {isSelfRoleChannel,validateSelfRoles,selfRolePanelPayload,handleSelfRoleClick} from "../src/discord-self-roles.ts";

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
  assert.throws(()=>validateSelfRoles([{id:xiv,label:"\nnewline"}],roles,8,guild),/label/);
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
