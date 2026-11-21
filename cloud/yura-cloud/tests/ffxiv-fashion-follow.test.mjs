import test from "node:test";
import assert from "node:assert/strict";
import {parseInitialManualFashion,parseFollowedFashion,pollFollowedFashion,acknowledgeFashionPoll} from "../src/ffxiv-fashion-follow.ts";

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
test("compressed current infographic still qualifies as a manual first report",()=>{
  const msg={...base,attachments:[{url:image,width:560,height:311,filename:"image.png"}]};
  const result=parseInitialManualFashion(msg,guild,channel);
  assert.equal(result?.id,"discord-fashion-manual-2222222222222222222");
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

test("already consumed first manual report is recovered and then cached for unchanged daily checks",async()=>{
  const originalFetch=globalThis.fetch;
  const now=new Date().toISOString();
  const sourceId="2222222222222222222",memberId="3333333333333333333";
  const first={id:"4444444444444444444",timestamp:now,author:{id:memberId,bot:false,username:"heiyeshi"},
    attachments:[{url:image,width:1100,height:650,filename:"Fashion_Report_Week_460.png"}],
    content:"Fashion Report Week 460 - Full Details"};
  const sourceUrl="channels/"+sourceId;
  const store=new Map([["ffxiv_fashion_follow_cursor_v1_"+guild+"_"+sourceId,first.id],
    ["ffxiv_fashion_first_manual_import_v2_"+guild+"_"+sourceId,"1"]]);
  const env={DISCORD_BOT_TOKEN:"test",DB:{
    prepare:(sql)=>({bind:(...args)=>({
      first:async()=>({value:store.get(args[0])||""}),
      run:async()=>{store.set(args[0],args[1]);return {}}
    })})
  }};
  let messages=[first];
  globalThis.fetch=async url=>{
    const p=String(url);
    if(p.endsWith("/"+sourceUrl))return new Response(JSON.stringify({id:sourceId,guild_id:guild,type:0}),{status:200});
    if(p.includes("/"+sourceUrl+"/messages?"))return new Response(JSON.stringify(messages),{status:200});
    throw Error("Unexpected Discord path "+p);
  };
  try {
    const recovered=await pollFollowedFashion(env,guild,sourceId);
    assert.equal(recovered.sourceStatus,"manual-current");
    assert.equal(recovered.candidate.id,"discord-fashion-week-460");
    await acknowledgeFashionPoll(env,guild,recovered);
    const unchanged=await pollFollowedFashion(env,guild,sourceId);
    assert.equal(unchanged.sourceStatus,"unchanged");
    assert.equal(unchanged.candidate.id,"discord-fashion-week-460");
    // A user can chat or upload an unrelated image; never replace a saved
    // Fashion week with those once the first manual image is acknowledged.
    messages=[first,{...first,id:"5555555555555555555",
      content:"Hello unrelated manually posted image",attachments:[]}];
    const still=await pollFollowedFashion(env,guild,sourceId);
    assert.equal(still.candidate.id,"discord-fashion-week-460");
    // New Fashion Reporter webhook brings next week automatically.
    messages=[...messages,{
      id:"6666666666666666666",timestamp:now,
      webhook_id:"7777777777777777777",author:{bot:true,username:"Fashion Reporter"},
      embeds:[{title:"Fashion Report Week 461 - Full Details",image:{url:image,width:1000,height:550}}]
    }];
    const next=await pollFollowedFashion(env,guild,sourceId);
    assert.equal(next.sourceStatus,"new");
    assert.equal(next.candidate.id,"discord-fashion-week-461");
  }finally{globalThis.fetch=originalFetch;}
});
