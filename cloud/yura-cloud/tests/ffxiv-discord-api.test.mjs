import test from "node:test";
import assert from "node:assert/strict";
import {discordFfxivRequest} from "../src/ffxiv-discord-api.ts";

const env={DISCORD_BOT_TOKEN:"ci-test-token"};
const response=(status,data,headers={})=>new Response(
  status===204?null:JSON.stringify(data),
  {status,headers:status===204?headers:{"content-type":"application/json",...headers}}
);

test("Discord Retry-After in 429 JSON is honored and the original request resumes",async()=>{
  const old=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,opts)=>{
    calls.push({url,method:opts.method,ts:Date.now()});
    return calls.length===1
      ? response(429,{message:"You are being rate limited.",retry_after:0.02,global:false},
        {"Retry-After":"0.02","X-RateLimit-Scope":"user"})
      : response(200,{id:"123456789012345678",ok:true});
  };
  try{
    const result=await discordFfxivRequest(env,"channels/123456789012345678");
    assert.equal(result.ok,true);
    assert.equal(calls.length,2);
    assert.ok(calls[1].ts-calls[0].ts>=125);
  }finally{globalThis.fetch=old;}
});
test("single 403 is terminal; no accidental repeated writes",async()=>{
  const old=globalThis.fetch;
  let attempts=0;
  globalThis.fetch=async()=>{attempts++;return response(403,{message:"Missing Access"});};
  try{
    await assert.rejects(
      discordFfxivRequest(env,"channels/999999999999999999/messages","POST",{content:"test"}),
      /HTTP 403/);
    assert.equal(attempts,1);
  }finally{globalThis.fetch=old;}
});
test("successful message PATCH with status 204 does not parse JSON",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>response(204,null);
  try{
    assert.equal(await discordFfxivRequest(env,
      "channels/333333333333333333/messages/555555555555555555","PATCH",{content:"unchanged"}),null);
  }finally{globalThis.fetch=old;}
});
test("long Retry-After is not retried in a burst",async()=>{
  const old=globalThis.fetch;
  let attempts=0;
  globalThis.fetch=async()=>{
    attempts++;
    return response(429,{retry_after:300,global:false},{"Retry-After":"300"});
  };
  try {
    await assert.rejects(discordFfxivRequest(env,
      "channels/666666666666666666/messages"),/HTTP 429/);
    assert.equal(attempts,1);
  }finally{globalThis.fetch=old;}
});
