// One compact, server-side FFXIV news job. Runs without Desktop or Discord Gateway.
import {discoverLiveEvents, type LiveEvent} from "./ffxiv-events";
import {discordFfxivRequest} from "./ffxiv-discord-api";
import {updateFourPosts, expireFourPosts, verifyFashionReportImage, refreshFfxivCardPalette, type SourceItem} from "./ffxiv-dashboard";
import {pollFollowedFashion, acknowledgeFashionPoll, type FashionPoll} from "./ffxiv-fashion-follow";
// Twitch broadcaster/Admin authentication is performed by the main Worker router.
interface NewsEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
}
type NewsConfig = {
  enabled: boolean;
  guildId: string;
  channelId: string;
  fashion: boolean;
  events: boolean;
  dalamud: boolean;
  lodestone: boolean;
  fashionSourceChannelId: string;
};
type NewsItem = { source: string; id: string; title: string; url: string; date: number; image?: string };
const DEFAULT_GUILD = "1181989574713557082"; // Existing YURA Discord schedule server.
const FEEDS = [
  { source: "lodestone-news", url: "https://eu.finalfantasyxiv.com/lodestone/news/news.xml" },
  { source: "lodestone-topics", url: "https://eu.finalfantasyxiv.com/lodestone/news/topics.xml" }
] as const;
const newsJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" }
});
const idOK = (s: string) => /^[0-9]{15,22}$/.test(s);
const now = () => new Date().toISOString();
const clamp = (s: unknown, max = 160) => String(s ?? "").trim().slice(0, max);
async function readMeta(env: NewsEnv, key: string): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(row?.value ?? "");
}
async function writeMeta(env: NewsEnv, key: string, val: string) {
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key,val).run();
}
async function loadConfig(env: NewsEnv): Promise<NewsConfig> {
  let saved: Partial<NewsConfig> = {};
  try { saved = JSON.parse(await readMeta(env,"ffxiv_news_config_v1") || "{}"); } catch {}
  let onboardingGuild = "";
  try {
    const x = JSON.parse(await readMeta(env,"discord_onboarding_config_v1") || "{}");
    onboardingGuild = idOK(String(x.guild ?? "")) ? String(x.guild) : "";
  } catch {}
  const guildId = idOK(String(saved.guildId ?? "")) ? String(saved.guildId) : (onboardingGuild || DEFAULT_GUILD);
  return {
    enabled: saved.enabled !== false, guildId,
    channelId: idOK(String(saved.channelId ?? "")) ? String(saved.channelId) : "",
    fashion: saved.fashion !== false, events: saved.events !== false,
    dalamud: saved.dalamud !== false, lodestone: saved.lodestone !== false,
    fashionSourceChannelId:idOK(String(saved.fashionSourceChannelId ?? ""))?String(saved.fashionSourceChannelId):""
  };
}
const discord=discordFfxivRequest;
async function channel(env: NewsEnv, cfg: NewsConfig): Promise<string> {
  if (cfg.channelId) {
    const found = await discord(env, "channels/" + cfg.channelId);
    if (String(found.guild_id) !== cfg.guildId || ![0,5].includes(Number(found.type)))
      throw new Error("FFXIV News channel is outside the configured guild or is not a text channel");
    return cfg.channelId;
  }
  const channels:any = await discord(env, "guilds/" + cfg.guildId + "/channels");
  if (!Array.isArray(channels)) throw new Error("Discord guild channel list unavailable");
  let found = channels.find((c:any) => c.name === "ffxiv-news" && Number(c.type) === 0);
  if (!found) {
    found = await discord(env, "guilds/" + cfg.guildId + "/channels", "POST", {
      name: "ffxiv-news", type: 0, topic: "FFXIV • Fashion Report • Dalamud | YURA Cloud, codziennie o 10:00"
    });
  }
  if (!idOK(String(found?.id ?? ""))) throw new Error("Discord did not return an FFXIV News channel ID");
  cfg.channelId = String(found.id);
  await writeMeta(env,"ffxiv_news_config_v1",JSON.stringify(cfg));
  return cfg.channelId;
}
async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { "accept": "application/atom+xml, application/rss+xml, application/xml, application/json, text/html",
      "user-agent": "YURA-Cloud-FFXIV-News/1.0 (+https://github.com/its-hei/YURA-Network)" }
  });
  if (!r.ok) throw new Error(new URL(url).hostname + ": HTTP " + r.status);
  return r.text();
}
function unescapeXml(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/<[^>]+>/g,"")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|[0-9]+);/gi, entity => {
      const named:Record<string,string> = { "&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'","&nbsp;":" " };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      try {
        const hex = /^&#x/i.test(entity);
        const n = parseInt(entity.slice(hex ? 3 : 2,-1),hex ? 16 : 10);
        return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      } catch { return ""; }
    }).trim();
}
function tag(raw: string, key: string): string {
  const m = raw.match(new RegExp("<" + key + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + key + ">","i"));
  return m ? unescapeXml(m[1]) : "";
}
async function lodestone(source: string, url: string): Promise<NewsItem[]> {
  // Square Enix's official *.xml sources are Atom (<feed>/<entry>), NOT
  // RSS 2.0 (<rss>/<item>). Use the NA mirror only if the EU feed fails.
  let xml = "";
  try {
    xml = await fetchText(url);
    if (!/<entry\b/i.test(xml)) throw new Error("EU Atom feed has no entries");
  } catch {
    xml = await fetchText(url.replace("eu.finalfantasyxiv.com","na.finalfantasyxiv.com"));
  }
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].slice(0,35);
  if (!entries.length) throw new Error("Lodestone Atom: no entries (" + source + ")");
  const result: NewsItem[] = [];
  for (const [, body] of entries) {
    const title = tag(body,"title");
    const urls = [...body.matchAll(/<link\b[^>]*\/?>/gi)];
    const alternate = urls.find(x=>/\brel\s*=\s*["']alternate["']/i.test(x[0])) || urls[0];
    const href = alternate?.[0].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || "";
    const link = unescapeXml(href).replace(/^http:\/\//,"https://");
    const published = Date.parse(tag(body,"published") || tag(body,"updated"));
    const uid = tag(body,"id") || link;
    if (!title || !Number.isFinite(published) || !/^https:\/\/(?:eu|na)\.finalfantasyxiv\.com\/lodestone\//i.test(link)) continue;
    result.push({source,id:uid.slice(0,400),title:title.slice(0,200),url:link,date:published});
  }
  if (!result.length) throw new Error("Lodestone Atom entries have no valid titles/URLs/dates");
  return result;
}
async function dalamud(): Promise<NewsItem[]> {
  // The GitHub releases API is not the active release feed (its latest public
  // GitHub Release is from March 2026). The actual stable distribution lives here:
  // https://github.com/goatcorp/dalamud-distrib/blob/main/version
  const raw = await fetchText("https://raw.githubusercontent.com/goatcorp/dalamud-distrib/main/version");
  let data:any;
  try { data = JSON.parse(raw); } catch { throw new Error("Dalamud stable version is not JSON"); }
  const version = String(data?.AssemblyVersion ?? "").trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version))
    throw new Error("Dalamud stable version format is invalid");
  return [{source:"dalamud",id:"stable-"+version,
    title:"Dalamud Stable "+version,
    url:"https://github.com/goatcorp/dalamud-distrib/blob/main/version",
    date:Date.now()}];
}
function warsawTime(date: Date): { day: string; hour: number; minute: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Europe/Warsaw", year:"numeric",month:"2-digit",day:"2-digit",
    weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(date);
  const val = (name:string) => parts.find(p => p.type === name)?.value || "";
  return { day:val("year")+"-"+val("month")+"-"+val("day"),
    hour:Number(val("hour")),minute:Number(val("minute")),weekday:val("weekday") };
}
async function fashionReport(): Promise<NewsItem> {
  const url = "https://fashionreportxiv.com/";
  // The publisher updates one permanent image each week. Detect actual changes,
  // not Friday's date; some weeks the image is published after our 10:00 poll.
  const imageUrl = new URL("hint.png",url);
  imageUrl.searchParams.set("date",warsawTime(new Date()).day);
  const response = await fetch(imageUrl.toString(), {
    headers: {accept:"image/png", "user-agent":"YURA-Cloud-FFXIV-News/1.1"}
  });
  if (!response.ok) throw new Error("Fashion Report image: HTTP "+response.status);
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("image/"))
    throw new Error("Fashion Report: image not available");
  const imageData = await response.arrayBuffer();
  if (imageData.byteLength < 20000 || imageData.byteLength > 5000000)
    throw new Error("Fashion Report image size unexpected");
  const digest = await crypto.subtle.digest("SHA-256",imageData);
  const hash = Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
  const displayImage = new URL("hint.png",url);
  displayImage.searchParams.set("v",hash.slice(0,16)); // Avoid Discord's old image cache.
  return { source:"fashion", id:"image-sha256-"+hash, date:Date.now(),
    title:"Fashion Report • aktualna grafika z rozwiązaniem (80/100 punktów)",
    url, image:displayImage.toString() };
}
async function seenFor(env: NewsEnv, source: string): Promise<Set<string>> {
  const rows = await env.DB.prepare("SELECT item_id FROM ffxiv_news_seen WHERE source=?1 ORDER BY first_seen_utc DESC LIMIT 300").bind(source).all<{item_id:string}>();
  return new Set((rows.results || []).map(x => x.item_id));
}
async function saveSeen(env: NewsEnv, items: NewsItem[]) {
  for(let i = 0; i < items.length; i += 60) {
    const statements = items.slice(i,i+60).map(x => env.DB.prepare(
      "INSERT OR IGNORE INTO ffxiv_news_seen(source,item_id,first_seen_utc) VALUES(?1,?2,?3)"
    ).bind(x.source,x.id,now()));
    if (statements.length) await env.DB.batch(statements);
  }
}
// Genuine patch notes only: do not replace the current patch with store news,
// livestreams or unrelated Lodestone Topics posts.
function isPatchArticle(x: NewsItem):boolean {
  return /\bpatch\s+\d+(?:\.\d+){1,3}\s+notes?\b|\bhotfix(?:es)?\b|\bpatch notes\b/i.test(x.title);
}
export async function checkFfxivNews(env: NewsEnv, force = false, repairFashion = false) {
  const cfg=await loadConfig(env);
  if (!cfg.enabled && !force) return {ok:true,status:"disabled",posted:false,items:0};
  const checkAt=now();
  const errors:string[]=[];
  let channelId="";
  try {
    channelId=await channel(env,cfg);
    const sources:{fashion?:SourceItem;dalamud?:SourceItem;patch?:SourceItem;events:LiveEvent[]|null}={events:null};
    const news:NewsItem[]=[];
    let topics:NewsItem[]|null=null;
    let fashionPoll:FashionPoll|null=null;
    const fashionDiagnostic:{status:string;source_channel:string;inspected:number;matched:number;report_id:string;error:string}={
      status:"not-checked",source_channel:"",inspected:0,matched:0,report_id:"",error:""
    };
    for(const feed of FEEDS){
      // The event detector always receives official Topics, independently
      // of the Patch Notes switch. Other news is optional.
      if(feed.source==="lodestone-news" && !cfg.lodestone)continue;
      if(feed.source==="lodestone-topics" && !cfg.events && !cfg.lodestone)continue;
      try{
        const items=await lodestone(feed.source,feed.url);
        if(feed.source==="lodestone-topics")topics=items;
        if(cfg.lodestone)news.push(...items);
      }catch(e:any){errors.push(feed.source+": "+String(e?.message||e));}
    }
    if(cfg.lodestone){
      const newest=news.filter(isPatchArticle).sort((a,b)=>b.date-a.date)[0];
      if(newest)sources.patch=newest;
      // On temporary RSS failure, leave the previous patch untouched.
    }
    if(cfg.events && topics){
      const events=await discoverLiveEvents(topics,fetchText,Date.now());
      errors.push(...events.errors.map(x=>"event: "+x));
      // A complete scan with no relevant active event authoritatively clears
      // the card. Partial fetch failures preserve the current card until
      // its already-verified expiry is reached.
      if(!events.errors.length || events.events.length) sources.events=events.events;
    }
    if(cfg.dalamud){
      try{sources.dalamud=(await dalamud())[0];}
      catch(e:any){errors.push("dalamud: "+String(e?.message||e));}
    }
    if(cfg.fashion){
      try {
        fashionPoll=await pollFollowedFashion(env,cfg.guildId,cfg.fashionSourceChannelId,repairFashion);
        if(!fashionPoll) {
          fashionDiagnostic.status="source-not-found";
          fashionDiagnostic.error="Kanał źródłowy Fashion nie został znaleziony; wybierz #mods・spam w YURZE.";
          errors.push("fashion: "+fashionDiagnostic.error);
        } else {
          fashionDiagnostic.status=fashionPoll.sourceStatus;
          fashionDiagnostic.source_channel=fashionPoll.sourceChannelId;
          fashionDiagnostic.inspected=fashionPoll.inspected;
          fashionDiagnostic.matched=fashionPoll.validImages;
          fashionDiagnostic.report_id=fashionPoll.candidate?.id||"";
          if(fashionPoll.candidate) sources.fashion=fashionPoll.candidate;
          if(!fashionPoll.candidate && fashionPoll.sourceStatus==="initialized")
            fashionDiagnostic.error="Nie znaleziono odpowiednio dużej infografiki w ostatnich 100 wiadomościach.";
          await writeMeta(env,"ffxiv_fashion_follow_last_status",fashionPoll.sourceStatus);
          await writeMeta(env,"ffxiv_fashion_follow_source_channel",fashionPoll.sourceChannelId);
        }
      } catch(e:any) {
        fashionDiagnostic.status="error";
        fashionDiagnostic.error=String(e?.message||e);
        errors.push("fashion-follow: "+fashionDiagnostic.error);
      }
    }
    const result=await updateFourPosts(env,{
      guildId:cfg.guildId,channelId,
      fashion:cfg.fashion,events:cfg.events,dalamud:cfg.dalamud,lodestone:cfg.lodestone
    },sources);
    errors.push(...result.errors);
    let fashionMedia:{attached:boolean;reason:string;messageId?:string}|null=null;
    if(repairFashion && cfg.fashion){
      try{
        fashionMedia=await verifyFashionReportImage(env,{
          guildId:cfg.guildId,channelId,
          fashion:cfg.fashion,events:cfg.events,
          dalamud:cfg.dalamud,lodestone:cfg.lodestone
        });
        if(!fashionMedia.attached)
          errors.push("fashion media: "+fashionMedia.reason);
      }catch(e:any){errors.push("fashion media verify: "+String(e?.message||e));}
    }
    if(result.errors.some(x=>x.startsWith("fashion "))) {
      fashionDiagnostic.status="publish-error";
      fashionDiagnostic.error=result.errors.filter(x=>x.startsWith("fashion ")).join(" | ");
    } else if(fashionPoll?.candidate && result.changes.includes("fashion")) {
      fashionDiagnostic.status="published";
    } else if(fashionPoll?.candidate) {
      fashionDiagnostic.status="already-current";
    }
    await writeMeta(env,"ffxiv_fashion_follow_last_diagnostic",JSON.stringify(fashionDiagnostic).slice(0,1500));
    if(fashionPoll && !result.errors.some(x=>x.startsWith("fashion "))) {
      try {await acknowledgeFashionPoll(env,cfg.guildId,fashionPoll);}
      catch(e:any) {errors.push("fashion-cursor: "+String(e?.message||e));}
    }
    await writeMeta(env,"ffxiv_news_last_check_utc",checkAt);
    await writeMeta(env,"ffxiv_news_last_status",errors.length?"partial":"ready");
    await writeMeta(env,"ffxiv_news_last_error",errors.join(" | ").slice(0,1200));
    if(result.updated)await writeMeta(env,"ffxiv_news_last_post_utc",now());
    return {ok:true,status:errors.length?"partial":"ready",
      posted:result.updated>0,items:result.updated,
      updated_sections:result.changes,channel_id:channelId,
      fashion_source:fashionDiagnostic,fashion_media:fashionMedia,source_errors:errors};
  }catch(e:any){
    const error=String(e?.message||e).slice(0,1000);
    await writeMeta(env,"ffxiv_news_last_check_utc",checkAt);
    await writeMeta(env,"ffxiv_news_last_status","error");
    await writeMeta(env,"ffxiv_news_last_error",error);
    return {ok:false,status:"error",error,channel_id:channelId};
  }
}
export async function scheduleFfxivNews(env: NewsEnv, scheduledAt: Date) {
  const t=warsawTime(scheduledAt);
  const today=t.day;
  // One-time compact Fashion text refresh. Edit the existing anchored
  // message in place without sending another Discord post; preserve its
  // current native infographic and its historical thread.
  const compactResetKey="ffxiv_fashion_linked_embed_v10_20261121";
  if((today==="2026-11-21" || today==="2026-11-22") && t.minute%5===1){
    const value=await readMeta(env,compactResetKey);
    const count=Number(value)||0;
    if(value!=="done" && count<2){
      await writeMeta(env,compactResetKey,String(count+1));
      const check=await checkFfxivNews(env,true,false);
      await writeMeta(env,"ffxiv_fashion_compact_reset_result",
        JSON.stringify(check).slice(0,1200));
      if(check.ok && !check.source_errors?.some(x=>
        /fashion update:|fashion attachment:|HTTP 429/.test(String(x))))
        await writeMeta(env,compactResetKey,"done");
    }
  }
  // Consolidated one-time repair for the current Fashion Report. Previous
  // v3-v6 repair jobs have been removed to avoid duplicate polls and Discord
  // rate limits. The actual message is checked for a native attachment by
  // Discord REST; only that verification marks this repair as complete.
  const mediaRepairKey="ffxiv_fashion_verified_attachment_repair_v8";
  if((today==="2026-11-21" || today==="2026-11-22") &&
      t.minute%5===3) {
    const state=await readMeta(env,mediaRepairKey);
    const count=Number(state)||0;
    if(state!=="done" && count<3) {
      await writeMeta(env,mediaRepairKey,String(count+1));
      const attempt=await checkFfxivNews(env,true,true);
      await writeMeta(env,"ffxiv_fashion_verified_attachment_diagnostic",
        JSON.stringify(attempt).slice(0,1800));
      if(attempt.ok && attempt.fashion_media?.attached===true)
        await writeMeta(env,mediaRepairKey,"done");
    }
  }
  // Apply the new coloured style to existing posts at the next :04 cron
  // without re-fetching articles or creating any new Discord messages.
  const paletteKey="ffxiv_card_palette_v11_embed_repair_20261122";
  // The next cron tick retries this migration, at most four times, then stops.
  {
    const value=await readMeta(env,paletteKey),attempt=Number(value)||0;
    if(value!=="done"&&attempt<4){
      const cfg=await loadConfig(env);
      if(cfg.enabled&&cfg.channelId){
        await writeMeta(env,paletteKey,String(attempt+1));
        try{
          const status=await refreshFfxivCardPalette(env,{
            guildId:cfg.guildId,channelId:cfg.channelId,
            fashion:cfg.fashion,events:cfg.events,dalamud:cfg.dalamud,lodestone:cfg.lodestone
          });
          await writeMeta(env,"ffxiv_card_palette_v11_result",JSON.stringify(status).slice(0,1900));
          if(status.checked===4&&status.verified===4&&!status.errors.length)
            await writeMeta(env,paletteKey,"done");
        }catch(e:any){
          await writeMeta(env,"ffxiv_card_palette_v11_result",
            JSON.stringify({error:String(e?.message||e).slice(0,200)}));
        }
      }
    }
  }
  // In-memory D1 deadline check only, hourly, independent of the once-a-day
  // source polling. It archives expired Event/Fashion cards without flooding.
  if(scheduledAt.getUTCMinutes()===0 && t.hour!==10) {
    const cfg=await loadConfig(env);
    if(cfg.enabled && cfg.channelId) {
      const ended=await expireFourPosts(env,{
        guildId:cfg.guildId,channelId:cfg.channelId,
        fashion:cfg.fashion,events:cfg.events,dalamud:cfg.dalamud,lodestone:cfg.lodestone
      },scheduledAt.getTime());
      if(ended.expired.length) await writeMeta(env,"ffxiv_news_last_post_utc",now());
      if(ended.errors.length) await writeMeta(env,"ffxiv_news_last_error",ended.errors.join(" | ").slice(0,1200));
    }
  }
  // Provision the four permanent posts once soon after deployment. This is
  // not a recurring source poll. A failed provisioning may retry at :00/:15.
  if(t.hour!==10 || t.minute!==0){
    if(t.minute%15!==0)return;
    if(await readMeta(env,"ffxiv_news_board_v3_bootstrapped")==="1")return;
    const r=await checkFfxivNews(env);
    if(r.ok && !r.source_errors?.length)
      await writeMeta(env,"ffxiv_news_board_v3_bootstrapped","1");
    return;
  }
  if(await readMeta(env,"ffxiv_news_last_daily_day")===today)return;
  const r=await checkFfxivNews(env);
  if(r.ok){
    await writeMeta(env,"ffxiv_news_last_daily_day",today);
    await writeMeta(env,"ffxiv_news_board_v3_bootstrapped","1");
  }
}
export async function ffxivNewsAdmin(req: Request,env:NewsEnv):Promise<Response> {
  const url=new URL(req.url);
  if(req.method==="GET"){
    const cfg=await loadConfig(env);
    return newsJson({ok:true,...cfg,last_check_utc:await readMeta(env,"ffxiv_news_last_check_utc"),
      last_post_utc:await readMeta(env,"ffxiv_news_last_post_utc"),
      status:await readMeta(env,"ffxiv_news_last_status"),
      error:await readMeta(env,"ffxiv_news_last_error"),
      fashion_source_diagnostic:await readMeta(env,"ffxiv_fashion_follow_last_diagnostic"),
      fashion_media_status:await readMeta(env,"ffxiv_fashion_media_status_v1"),
      daily_at:"10:00 Europe/Warsaw",layout:"4 editable posts with history threads"});
  }
  if(req.method==="PUT"){
    let x:any;
    try{x=await req.json();}catch{return newsJson({error:"Invalid JSON"},400);}
    const prev=await loadConfig(env);
    const guildId=x.guildId===undefined?prev.guildId:String(x.guildId).trim();
    const channelId=x.channelId===undefined?prev.channelId:String(x.channelId).trim();
    const fashionSourceChannelId=x.fashionSourceChannelId===undefined
      ?prev.fashionSourceChannelId:String(x.fashionSourceChannelId).trim();
    if(!idOK(guildId) || (channelId&&!idOK(channelId)) ||
      (fashionSourceChannelId&&!idOK(fashionSourceChannelId)))
      return newsJson({error:"Invalid guild/channel/source ID"},400);
    const cfg:NewsConfig={
      guildId,channelId,fashionSourceChannelId,
      enabled:x.enabled===undefined?prev.enabled:x.enabled===true,
      fashion:x.fashion===undefined?prev.fashion:x.fashion===true,
      events:x.events===undefined?prev.events:x.events===true,
      dalamud:x.dalamud===undefined?prev.dalamud:x.dalamud===true,
      lodestone:x.lodestone===undefined?prev.lodestone:x.lodestone===true
    };
    for(const id of [cfg.channelId,cfg.fashionSourceChannelId]) {
      if(!id)continue;
      if(id===prev.channelId && cfg.guildId===prev.guildId)continue;
      if(id===prev.fashionSourceChannelId && cfg.guildId===prev.guildId)continue;
      const d=await discord(env,"channels/"+id);
      if(String(d.guild_id)!==cfg.guildId || ![0,5].includes(Number(d.type)))
        return newsJson({error:"Selected Discord channel belongs to another server"},400);
    }
    await writeMeta(env,"ffxiv_news_config_v1",JSON.stringify(cfg));
    // A new channel needs its own initial four-post setup.
    if(cfg.guildId!==prev.guildId || cfg.channelId!==prev.channelId)
      await writeMeta(env,"ffxiv_news_board_v3_bootstrapped","0");
    return newsJson({ok:true,...cfg,daily_at:"10:00 Europe/Warsaw"});
  }
  if(req.method==="POST"){
    let x:any={};try{x=await req.json();}catch{}
    if(x.action==="test"){
      try{
        const cfg=await loadConfig(env);
        const id=await channel(env,cfg);
        await discord(env,"channels/"+id+"/messages","POST",{
          content:"✅ **YURA FFXIV** • test połączenia, automatyczne sprawdzanie codziennie o 10:00.",
          allowed_mentions:{parse:[]}
        });
        return newsJson({ok:true,status:"test-sent",channel_id:id});
      }catch(e:any){return newsJson({ok:false,error:String(e?.message||e)},502);}
    }
    // Both CHECK NOW and PUBLISH LATEST refresh the four persistent messages.
    // Neither creates a duplicate when source content is unchanged.
    const r=await checkFfxivNews(env,true,x.action==="publish-latest");
    return newsJson(r,r.ok?200:502);
  }
  return newsJson({error:"Method not allowed"},405);
}
