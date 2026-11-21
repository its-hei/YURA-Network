// One compact, persistent Discord dashboard, including the current in-game
// event. Older announcements are written to ONE history thread, not the main
// channel. Stored in D1: Desktop and Worker upgrades never reset its state.
import type {LiveEvent} from "./ffxiv-events";

interface DashboardEnv { DB:D1Database; DISCORD_BOT_TOKEN?:string }
export type DashboardItem = { source:string; id:string; title:string; url:string; date:number; image?:string };
export type DashboardConfig = {
  guildId:string; channelId:string; fashion:boolean; dalamud:boolean; lodestone:boolean
};
type CurrentEvent = { title:string;url:string;start:number;end:number };
type Snapshot = {
  fashion?:DashboardItem; dalamud?:DashboardItem; lodestone?:DashboardItem; event?:CurrentEvent
};
const ID_OK = (s:string)=>/^\d{15,22}$/.test(s);
const MAIN_TITLE = "📰 FFXIV • AKTUALNE";
const MAIN_MARKER = "**"+MAIN_TITLE+"**";
const LAYOUT_VERSION = "2-compact-four-categories";

async function getMeta(env:DashboardEnv,key:string):Promise<string> {
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value ?? "");
}
async function setMeta(env:DashboardEnv,key:string,value:string):Promise<void> {
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key,value).run();
}
async function discord(env:DashboardEnv,path:string,method="GET",data?:unknown):Promise<any>{
  if(!env.DISCORD_BOT_TOKEN?.trim()) throw new Error("DISCORD_BOT_TOKEN not configured");
  const response=await fetch("https://discord.com/api/v10/"+path,{
    method,
    headers:{authorization:"Bot "+env.DISCORD_BOT_TOKEN.trim(),"content-type":"application/json",
      "user-agent":"YURA-Cloud/FFXIV-Dashboard-1.0"},
    ...(data===undefined?{}:{body:JSON.stringify(data)})
  });
  if(!response.ok) throw new Error("Discord "+method+" "+path.split("/")[0]+": HTTP "+response.status);
  return response.status===204?null:response.json();
}
function itemSafe(x:any):x is DashboardItem {
  return !!x && typeof x==="object" && typeof x.id==="string" &&
    typeof x.title==="string" && typeof x.url==="string" &&
    /^https:\/\//.test(x.url);
}
async function loadState(env:DashboardEnv,key:string):Promise<Snapshot> {
  try {
    const v=JSON.parse(await getMeta(env,key)||"{}");
    const out:Snapshot={};
    for (const category of ["fashion","dalamud","lodestone"] as const)
      if(itemSafe(v?.[category])) out[category]=v[category];
    const e=v?.event;
    if(e && typeof e.title==="string" && typeof e.url==="string" &&
       /^https:\/\/(?:eu|na)\.finalfantasyxiv\.com\/lodestone\//.test(e.url) &&
       Number.isFinite(e.start) && Number.isFinite(e.end))
      out.event=e;
    return out;
  }catch{return {};}
}
function short(s:string,n=110):string {
  return String(s||"").replace(/[\r\n]+/g," ").trim().slice(0,n);
}
function formatEvent(event:CurrentEvent | undefined):string {
  if(!event) return "Brak potwierdzonego aktywnego wydarzenia.";
  const epoch=Math.floor(event.end/1000);
  return "**"+short(event.title,115)+"** — koniec <t:"+epoch+":f> (<t:"+epoch+":R>)\n"+event.url;
}
function formatCurrent(snapshot:Snapshot,cfg:DashboardConfig):string{
  const fashion=cfg.fashion ? snapshot.fashion : undefined;
  const dalamud=cfg.dalamud ? snapshot.dalamud : undefined;
  const lodestone=cfg.lodestone ? snapshot.lodestone : undefined;
  const rows=[
    MAIN_MARKER,
    "",
    "**👗 FASHION REPORT**",
    fashion ? "Rozwiązanie 80/100 pkt • 60 000 MGP\n"+fashion.url : "Brak aktualnej grafiki",
    "",
    "**🟢 DALAMUD**",
    dalamud ? short(dalamud.title,100)+"\n"+dalamud.url : "Brak danych o stabilnej wersji",
    "",
    "**⚔️ FFXIV / PATCH NOTES**",
    lodestone ? short(lodestone.title,110)+"\n"+lodestone.url : "Brak nowych ogłoszeń",
    "",
    "**🎉 AKTUALNY EVENT**",
    formatEvent(snapshot.event),
    "",
    "📁 Historia zmian znajduje się we wątku poniżej."
  ];
  return rows.join("\n").slice(0,1950);
}
function dashboardEmbeds(snapshot:Snapshot,cfg:DashboardConfig):unknown[] {
  const f=cfg.fashion ? snapshot.fashion :undefined;
  if(!f?.image) return [];
  const image=new URL(f.image);
  if(image.protocol!=="https:" || image.hostname!=="fashionreportxiv.com") return [];
  return [{
    color:0xe89b52,title:"👗 Fashion Report — grafika tygodnia",
    url:"https://fashionreportxiv.com/",
    image:{url:image.toString()},
    footer:{text:"YURA Cloud • materiały: Fashion Report XIV"}
  }];
}
function friendlyEventTitle(x:LiveEvent):string {
  if(/final fantasy (?:xiv|14).{0,25}(?:x|×).{0,25}final fantasy (?:xvi|16)/i.test(x.title))
    return "The Path Infernal (FFXIV × FFXVI)";
  return short(x.title,120);
}
function updatedSnapshot(
  old:Snapshot,
  cfg:DashboardConfig,
  observed:Partial<Record<"fashion"|"dalamud"|"lodestone",DashboardItem>>,
  currentEvents:LiveEvent[]|null,
  at:number
):Snapshot {
  const next:Snapshot={...old};
  for(const key of ["fashion","dalamud","lodestone"] as const)
    if(observed[key]) next[key]=observed[key];
  if(currentEvents!==null) {
    const active=currentEvents.find(x=>x.start<=at && at<x.end);
    if(active) next.event={title:friendlyEventTitle(active),url:active.url,start:active.start,end:active.end};
    else delete next.event;
  } else if(next.event && next.event.end<=at) delete next.event;
  // The event is automatically removed when the official end time passes;
  // we never display an event as active beyond its verified end.
  if(next.event && next.event.end<=at) delete next.event;
  return next;
}
function equal(a:Snapshot,b:Snapshot):boolean {
  return JSON.stringify(a)===JSON.stringify(b);
}
async function master(env:DashboardEnv,cfg:DashboardConfig,base:string):Promise<string>{
  const key=base+"_anchor";
  const saved=await getMeta(env,key);
  if(ID_OK(saved)) {
    try {
      const msg=await discord(env,"channels/"+cfg.channelId+"/messages/"+saved);
      if(String(msg?.content??"").startsWith(MAIN_MARKER) && msg?.author?.bot) return saved;
    }catch {/* Recover from a deleted message. */}
  }
  const messages:any=await discord(env,"channels/"+cfg.channelId+"/messages?limit=100");
  const found=Array.isArray(messages)
    ? messages.find((m:any)=>m.author?.bot && String(m.content??"").startsWith(MAIN_MARKER))
    : null;
  if(found && ID_OK(String(found.id))){
    await setMeta(env,key,String(found.id));
    return String(found.id);
  }
  const created=await discord(env,"channels/"+cfg.channelId+"/messages","POST",{
    content:MAIN_MARKER+"\nŁadowanie aktualnych informacji…",allowed_mentions:{parse:[]}
  });
  const id=String(created?.id??"");
  if(!ID_OK(id)) throw new Error("Discord did not return dashboard message id");
  await setMeta(env,key,id);
  return id;
}
async function historyThread(env:DashboardEnv,cfg:DashboardConfig,base:string,anchor:string):Promise<string>{
  const key=base+"_thread";
  const saved=await getMeta(env,key);
  if(ID_OK(saved)) {
    try {
      const t=await discord(env,"channels/"+saved);
      if(String(t.parent_id)===cfg.channelId && [11,12].includes(Number(t.type))) {
        if(t.thread_metadata?.archived) {
          if(t.thread_metadata?.locked) throw new Error("FFXIV history thread locked");
          await discord(env,"channels/"+saved,"PATCH",{archived:false});
        }
        return saved;
      }
    }catch {/* Reconcile existing linked thread. */}
  }
  let id="";
  try {
    const existing=await discord(env,"channels/"+anchor);
    if(existing?.parent_id===cfg.channelId && [11,12].includes(Number(existing.type)))
      id=String(existing.id);
  }catch {}
  if(!ID_OK(id)) {
    const t=await discord(env,"channels/"+cfg.channelId+"/messages/"+anchor+"/threads","POST",{
      name:"📁 FFXIV — historia zmian",auto_archive_duration:1440
    });
    id=String(t?.id??"");
  }
  if(!ID_OK(id)) throw new Error("Discord did not return FFXIV history thread ID");
  await setMeta(env,key,id);
  return id;
}
function historyText(items:DashboardItem[],events:LiveEvent[]|null):string {
  const parts=["**📁 FFXIV — zapis zmian**"];
  for(const item of items.slice(0,6)) {
    const type=item.source==="fashion"?"👗 Fashion Report":
      item.source==="dalamud"?"🟢 Dalamud":"⚔️ FFXIV";
    parts.push(type+" — "+short(item.title,95)+"\n"+item.url);
  }
  if(events?.length){
    for(const e of events.slice(0,2))
      parts.push("🎉 Event — "+friendlyEventTitle(e)+"\n"+e.url);
  }
  return parts.join("\n\n").slice(0,1900);
}
export async function updateNewsDashboard(
  env:DashboardEnv,cfg:DashboardConfig,items:DashboardItem[],
  observed:Partial<Record<"fashion"|"dalamud"|"lodestone",DashboardItem>>,
  events:LiveEvent[]|null,
  opts?:{preview?:boolean}
):Promise<{changed:boolean;archived:number;mainMessageId:string}> {
  if(!ID_OK(cfg.channelId)) throw new Error("FFXIV dashboard channel not configured");
  const base="ffxiv_news_dashboard_v2_"+cfg.guildId+"_"+cfg.channelId;
  const old=await loadState(env,base+"_state");
  const next=updatedSnapshot(old,cfg,observed,events,Date.now());
  const oldSig=await getMeta(env,base+"_layout");
  const changed=!equal(old,next) || oldSig!==LAYOUT_VERSION || opts?.preview===true;
  if(!changed && items.length===0)
    return {changed:false,archived:0,mainMessageId:await getMeta(env,base+"_anchor")};

  const anchor=await master(env,cfg,base);
  if(items.length) {
    // Archive only genuine new items, never the whole source backlog on
    // startup. One main post + one category-labelled history thread.
    const thread=await historyThread(env,cfg,base,anchor);
    await discord(env,"channels/"+thread+"/messages","POST",{
      content:historyText(items,events),allowed_mentions:{parse:[]}
    });
  }
  if(changed){
    await discord(env,"channels/"+cfg.channelId+"/messages/"+anchor,"PATCH",{
      content:formatCurrent(next,cfg),allowed_mentions:{parse:[]},
      embeds:dashboardEmbeds(next,cfg)
    });
    await setMeta(env,base+"_state",JSON.stringify(next));
    await setMeta(env,base+"_layout",LAYOUT_VERSION);
  }
  return {changed,archived:items.length,mainMessageId:anchor};
}
