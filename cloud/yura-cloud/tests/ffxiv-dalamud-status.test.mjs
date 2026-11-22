import test from "node:test";
import assert from "node:assert/strict";
import {classifyDalamudAnnouncement,parseFollowedDalamudMessages} from "../src/ffxiv-dalamud-status.ts";
const guild="911111111111111111",channel="922222222222222222",
  sourceGuild="933333333333333333",sourceChannel="944444444444444444";
const now=Date.UTC(2026,10,22,18);
const official=(id,content,date=now-60000,author="KazWolfe")=>({
  id,webhook_id:"955555555555555555",
  content,timestamp:new Date(date).toISOString(),
  author:{username:author,bot:true},
  message_reference:{guild_id:sourceGuild,channel_id:sourceChannel,message_id:id}
});
test("KazWolfe restoration announcement is recognized, without inventing an ETA",()=>{
  const id="966666666666666666";
  const input=[{id:"977777777777777777",timestamp:new Date(now).toISOString(),
      author:{username:"Y.U.R.A.",bot:true},content:"Stable 15.0.4.1"},
    official(id,"**Patch 7.58 - Dalamud Updated**\n"+
      "The game servers are back, the plugins are back, weekly reset has happened.")];
  const r=parseFollowedDalamudMessages(input,guild,channel,now);
  assert.equal(r.inspected,2);
  assert.equal(r.followed,1);
  assert.equal(r.qualified,1);
  assert.equal(r.status.messageId,id);
  assert.equal(r.status.state,"available");
  assert.equal(r.status.eta,"");
  assert.equal(r.status.author,"KazWolfe");
  assert.equal(r.status.sourceUrl,
    "https://discord.com/channels/"+sourceGuild+"/"+sourceChannel+"/"+id);
});
test("Newest official outage with a stated ETA supersedes a prior restoration",()=>{
  const older=official("966666666666666661","The plugins are back.",now-100000);
  const latest=official("966666666666666662",
    "Dalamud is currently unavailable. We are working on compatibility. ETA: Friday 19:00.",now-1000);
  const r=parseFollowedDalamudMessages([older,latest],guild,channel,now);
  assert.equal(r.status.messageId,latest.id);
  assert.equal(r.status.state,"unavailable");
  assert.equal(r.status.eta,"Friday 19:00");
});
test("No confirmed ETA is never fabricated",()=>{
  const r=parseFollowedDalamudMessages([
    official("966666666666666663","Plugins are disabled after the game patch. No ETA at this time.")
  ],guild,channel,now);
  assert.equal(r.status.state,"unavailable");
  assert.equal(r.status.eta,"");
});
test("Non-followed text, bots impersonating KazWolfe and off-topic webhooks are ignored",()=>{
  const copy={...official("966666666666666664","Plugins are back"),webhook_id:null};
  const unrelated=official("966666666666666665","Plugins are back",now-3000,"Another Bot");
  const notStatus=official("966666666666666666","Greetings everybody!",now-1000);
  const result=parseFollowedDalamudMessages([copy,unrelated,notStatus],guild,channel,now);
  assert.equal(result.followed,2);
  assert.equal(result.qualified,0);
  assert.equal(result.status,null);
});
test("Source link falls back safely to the forwarded post when origin IDs are incomplete",()=>{
  const msg=official("966666666666666667","Plugins are back",now-8000);
  msg.message_reference={channel_id:sourceChannel};
  const r=parseFollowedDalamudMessages([msg],guild,channel,now);
  assert.equal(r.status.sourceUrl,
    "https://discord.com/channels/"+guild+"/"+channel+"/"+msg.id);
});
test("Vague plugin update wording is not proof plugins work",()=>{
  assert.equal(classifyDalamudAnnouncement("Dalamud updated, plugins still being tested."),"working");
  assert.equal(classifyDalamudAnnouncement("The patch is live, but plugins do not yet work."),"unknown");
  assert.equal(classifyDalamudAnnouncement("Plugins are back."),"available");
});
