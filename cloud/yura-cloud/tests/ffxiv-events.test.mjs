import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOfficialEventPage, discoverLiveEvents, eligibleEventTitle
} from "../src/ffxiv-events.ts";

const currentArticle = '<!DOCTYPE html><html><head><meta property="og:image" content="https://lds-img.finalfantasyxiv.com/assets/path-infernal.png"></head>' +
'<body><article><h3>Event Schedule</h3><p>Wednesday, 18 November 2026 at 8:00 (GMT) / 19:00 (AEDT) ' +
'to Wednesday, 9 December 2026 at 14:59 (GMT) / 10 December at 1:59 (AEDT)</p></article></body></html>';

test("Official EU event schedules in parenthesized GMT parse correctly",()=>{
  const result=parseOfficialEventPage(currentArticle);
  assert.ok(result);
  assert.equal(result.start,Date.UTC(2026,10,18,8));
  assert.equal(result.end,Date.UTC(2026,11,9,14,59));
  assert.match(result.image||"",/finalfantasyxiv.com/);
});
test("Special-site schedule starting with From ... to ... parses",()=>{
  const site=currentArticle.replace("Wednesday, 18","From Wednesday, 18");
  assert.equal(parseOfficialEventPage(site)?.end,Date.UTC(2026,11,9,14,59));
});
test("Announcement about the actual crossover is an eligible game event",()=>{
  assert.ok(eligibleEventTitle("FINAL FANTASY XIV x FINAL FANTASY XVI Crossover Event Returns!"));
  assert.equal(eligibleEventTitle("Fan Festival 2026 Ticket Sales"),false);
});
test("Currently-running crossover shows the official announcement",async()=>{
  const at=Date.UTC(2026,10,21,16);
  const topics=[{
    title:"FINAL FANTASY XIV x FINAL FANTASY XVI Crossover Event Returns!",
    url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/a5c6207a2b4f4c46266a195802ee7e0a426617b3",
    date:Date.UTC(2026,10,17)
  }];
  const x=await discoverLiveEvents(topics,async()=>currentArticle,at);
  assert.equal(x.errors.length,0);
  assert.equal(x.events.length,1);
  assert.equal(x.events[0].end,Date.UTC(2026,11,9,14,59));
});
test("Official special event page recovers temporarily absent Topics item",async()=>{
  const at=Date.UTC(2026,10,21);
  const x=await discoverLiveEvents([],async url=>{
    assert.equal(url,"https://eu.finalfantasyxiv.com/lodestone/special/ffxvi/e86ytg2ko3");
    return currentArticle;
  },at);
  assert.equal(x.events[0]?.title,"The Path Infernal — FFXIV × FFXVI");
});
test("All simultaneous verified active events are returned, not just the latest",async()=>{
  const at=Date.UTC(2026,10,21,16);
  const titles=["Starlight Celebration","Heavensturn","The Rising","All Saints Wake","Moonfire Faire"];
  const topics=titles.map((title,i)=>({
    title,
    url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/"+String(i+10).repeat(16),
    date:at-i*86400000
  }));
  const events=await discoverLiveEvents(topics,async()=>currentArticle,at);
  assert.deepEqual(events.errors,[]);
  assert.equal(events.events.length,5,"all overlapping verified events returned");
  assert.equal(new Set(events.events.map(e=>e.url)).size,5);
});
test("Official crossover fallback remains visible alongside other live events",async()=>{
  const at=Date.UTC(2026,10,21,16);
  const onlyOther=[{
    title:"Starlight Celebration",
    url:"https://eu.finalfantasyxiv.com/lodestone/topics/detail/abcdef0123456789",
    date:at-86400000
  }];
  const result=await discoverLiveEvents(onlyOther,async()=>currentArticle,at);
  assert.equal(result.events.length,2);
  assert.ok(result.events.some(e=>e.title.includes("The Path Infernal")));
  assert.ok(result.events.some(e=>e.title==="Starlight Celebration"));
});
test("An expired event never stays active",async()=>{
  const at=Date.UTC(2026,11,10);
  const x=await discoverLiveEvents([],async()=>currentArticle,at);
  assert.equal(x.events.length,0);
});
test("Date-less promotions cannot become active events",()=>{
  assert.equal(parseOfficialEventPage('<h3>Event Schedule</h3><p>Coming soon</p>'),null);
});
