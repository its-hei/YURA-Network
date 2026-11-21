import test from "node:test";
import assert from "node:assert/strict";
import {parseInitialManualFashion,parseFollowedFashion} from "../src/ffxiv-fashion-follow.ts";

const guild="1181989574713557082";
const channel="1111111111111111111";
const now=new Date().toISOString();
const image="https://cdn.discordapp.com/attachments/1111111111111111111/2222222222222222222/Fashion_Report_Week_460.png?ex=abc";
const base={id:"2222222222222222222",timestamp:now,author:{id:"3333333333333333333",bot:false,username:"heiyeshi"}};

test("first manually uploaded current report becomes the initial active image",()=>{
  const msg={...base,content:"Fashion Report Week 460 - Full Details #ffxiv",
    attachments:[{url:image,width:1100,height:650,filename:"Fashion_Report_Week_460.png"}]};
  const result=parseInitialManualFashion(msg,guild,channel);
  assert.ok(result);
  assert.equal(result.id,"discord-fashion-week-460");
  assert.equal(result.image,image);
  assert.equal(parseFollowedFashion(msg,guild,channel),null);
});
test("first native Discord forward reads image in message_snapshots",()=>{
  const msg={...base,type:28,message_reference:{type:1,channel_id:"4444444444444444444"},
    message_snapshots:[{message:{content:"Fashion Report Week 460 - Full Details",
      embeds:[{title:"Fashion Report Week 460",image:{url:image,width:1100,height:650}}]}}]};
  assert.equal(parseInitialManualFashion(msg,guild,channel)?.id,"discord-fashion-week-460");
  assert.equal(parseFollowedFashion(msg,guild,channel),null);
});
test("first manual image without a caption is accepted if large and recent",()=>{
  const msg={...base,attachments:[{url:image,width:1000,height:650,filename:"image.png"}]};
  const result=parseInitialManualFashion(msg,guild,channel);
  assert.equal(result?.id,"discord-fashion-manual-2222222222222222222");
});
test("ordinary chat and unrelated bot webhooks are ignored on future checks",()=>{
  const normal={...base,content:"Fashion Report Week 461",attachments:[{url:image}]};
  assert.equal(parseFollowedFashion(normal,guild,channel),null);
  const spoof={...normal,webhook_id:"5555555555555555555",author:{username:"Other Integration"}};
  assert.equal(parseFollowedFashion(spoof,guild,channel),null);
});
test("a newly mirrored Fashion Reporter announcement becomes the next week",()=>{
  const mirrored={...base,webhook_id:"5555555555555555555",
    author:{username:"Fashion Reporter",bot:true},
    embeds:[{title:"Fashion Report Week 461 - Full Details",image:{url:image,width:1000,height:600}}]};
  const result=parseFollowedFashion(mirrored,guild,channel);
  assert.equal(result?.id,"discord-fashion-week-461");
});
