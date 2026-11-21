// One compact, server-side FFXIV news job. Runs without Desktop or Discord Gateway.
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
  dalamud: boolean;
  lodestone: boolean;
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
    fashion: saved.fashion !== false, dalamud: saved.dalamud !== false, lodestone: saved.lodestone !== false
  };
}
async function discord(env: NewsEnv, path: string, method = "GET", body?: unknown): Promise<any> {
  if (!env.DISCORD_BOT_TOKEN?.trim()) throw new Error("DISCORD_BOT_TOKEN missing in Cloud secrets");
  const r = await fetch("https://discord.com/api/v10/" + path, {
    method, headers: {
      "authorization": "Bot " + env.DISCORD_BOT_TOKEN.trim(),
      "content-type": "application/json", "user-agent": "YURA-Cloud-FFXIV-News/1.0"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!r.ok) throw new Error("Discord " + method + " " + path.split("/")[0] + ": HTTP " + r.status);
  return r.status === 204 ? null : r.json();
}
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
function linesFor(items:NewsItem[], manualPreview = false): string {
  const by = (source:string) => items.filter(x => x.source===source);
  const output = ["**📰 FFXIV NEWS • YURA**", manualPreview ? "🧪 Jednorazowy test: najnowsze dostępne informacje z trzech kategorii." : "Nowe informacje z ostatniego sprawdzenia:", ""];
  const fashion = by("fashion");
  if (fashion.length) {
    output.push("**👗 Fashion Report**");
    for(const x of fashion) output.push("• Gotowa grafika poniżej • 80 punktów = 60 000 MGP • "+x.url);
    output.push("");
  }
  const dal = by("dalamud");
  if (dal.length) {
    output.push("**🟢 Dalamud • wersja stabilna**");
    for(const x of dal.slice(0,5)) output.push("• "+clamp(x.title,110)+" — "+x.url);
    if (dal.length>5) output.push("• oraz "+(dal.length-5)+" innych zmian");
    output.push("");
  }
  const lod = items.filter(x=>x.source.startsWith("lodestone"));
  if (lod.length) {
    output.push("**⚔️ Final Fantasy XIV • Lodestone**");
    for(const x of lod.slice(0,7)) output.push("• "+clamp(x.title,110)+" — "+x.url);
    if (lod.length>7) output.push("• oraz "+(lod.length-7)+" innych ogłoszeń");
  }
  return output.join("\n").slice(0,1950);
}
function newsCategory(item: NewsItem): "fashion" | "dalamud" | "lodestone" {
  return item.source === "fashion" ? "fashion" : item.source === "dalamud" ? "dalamud" : "lodestone";
}
type NewsCategory = ReturnType<typeof newsCategory>;

const NEWS_TOPIC: Record<NewsCategory,{title:string;thread:string}> = {
  fashion: {title:"👗 FASHION REPORT • AKTUALNE",thread:"👗 Fashion Report — archiwum"},
  dalamud: {title:"🟢 DALAMUD • STABLE",thread:"🟢 Dalamud — archiwum"},
  lodestone:{title:"⚔️ FINAL FANTASY XIV • AKTUALNOŚCI",thread:"⚔️ FFXIV — archiwum"}
};
function topicMessage(topic:NewsCategory, entries:NewsItem[],history=false):string {
  const head = "**"+NEWS_TOPIC[topic].title+"**";
  const date = warsawTime(new Date()).day;
  const lines = [head, ...(history ? ["📁 Wpis z "+date+" • historia pozostaje w tym wątku."] : ["Najnowsza informacja • starsze wpisy znajdziesz w wątku."]),""];
  if(topic==="fashion"){
    lines.push("Grafika z rozwiązaniem na 80/100 punktów • do 60 000 MGP");
    lines.push(entries[0]?.url || "https://fashionreportxiv.com/");
  } else {
    for(const item of entries.slice(0,history?7:1))
      lines.push("• "+clamp(item.title,120)+" — "+item.url);
    if(history && entries.length>7) lines.push("• oraz "+(entries.length-7)+" innych ogłoszeń");
  }
  return lines.join("\n").slice(0,1950);
}
function newsEmbeds(topic:NewsCategory, entries:NewsItem[]):unknown[] {
  if (topic!=="fashion") return [];
  const f = entries.find(x=>x.image);
  if (!f) return [];
  return [{
    color:0xe89b52,
    title:"👗 FASHION REPORT • 80/100 PUNKTÓW",
    description:"Aktualna grafika tygodnia • do 60 000 MGP w Gold Saucer.",
    url:f.url,
    image:{url:f.image},
    footer:{text:"Źródło: Fashion Report XIV"}
  }];
}
function archiveKey(cfg:NewsConfig, id:string, topic:NewsCategory) {
  return "ffxiv_news_archive_v1_"+cfg.guildId+"_"+id+"_"+topic;
}
async function ensureCategoryThread(env:NewsEnv,cfg:NewsConfig,channelId:string,topic:NewsCategory) {
  const key=archiveKey(cfg,channelId,topic);
  let previous:{anchor:string;thread:string}|null=null;
  try {previous=JSON.parse(await readMeta(env,key) || "null");} catch {}
  if (previous && idOK(previous.anchor) && idOK(previous.thread)) {
    try {
      const t = await discord(env,"channels/"+previous.thread);
      if (String(t.parent_id)===channelId && String(t.guild_id)===cfg.guildId && [11,12].includes(Number(t.type)))
        return previous;
    } catch {/* Reconcile the existing anchor before creating anything. */}
  }

  // Recover an existing bot-created category anchor after a partial D1 write.
  // Never touch community messages or test posts sent by other bots.
  const messages:any = await discord(env,"channels/"+channelId+"/messages?limit=100");
  const title=NEWS_TOPIC[topic].title;
  const found=Array.isArray(messages)
    ? messages.find((m:any)=>m.author?.bot===true && String(m.content??"").startsWith("**"+title+"**"))
    : null;
  let anchor=String(found?.id ?? "");
  if (!idOK(anchor)) {
    const created=await discord(env,"channels/"+channelId+"/messages","POST",{
      content:"**"+title+"**\nNowe wiadomości pojawią się w tym poście. Historia jest zapisywana w wątku.",
      allowed_mentions:{parse:[]}
    });
    anchor=String(created?.id ?? "");
    if (!idOK(anchor)) throw new Error("Discord did not return category anchor ID");
  }

  // A thread created from a message shares its snowflake ID with the starter.
  // GET before POST prevents a duplicate thread when the D1 write failed.
  let thread="";
  try {
    const t=await discord(env,"channels/"+anchor);
    if (String(t.parent_id)===channelId && [11,12].includes(Number(t.type))) thread=String(t.id);
  } catch {}
  if(!thread) {
    const created=await discord(env,"channels/"+channelId+"/messages/"+anchor+"/threads","POST",{
      name:NEWS_TOPIC[topic].thread,auto_archive_duration:1440
    });
    thread=String(created?.id ?? "");
    if(!idOK(thread)) throw new Error("Discord did not return category thread ID");
  }
  const state={anchor,thread};
  await writeMeta(env,key,JSON.stringify(state));
  return state;
}
async function publishInArchive(env:NewsEnv,cfg:NewsConfig,channelId:string,topic:NewsCategory,entries:NewsItem[]):Promise<void> {
  const state=await ensureCategoryThread(env,cfg,channelId,topic);
  const thread:any=await discord(env,"channels/"+state.thread);
  if (thread.thread_metadata?.archived) {
    if (thread.thread_metadata?.locked) throw new Error("Discord archive thread is locked: "+topic);
    await discord(env,"channels/"+state.thread,"PATCH",{archived:false});
  }
  // Publish full entry in the archived timeline first. Then update the one
  // permanent main-channel message to display only the latest entry.
  const embeds=newsEmbeds(topic,entries);
  await discord(env,"channels/"+state.thread+"/messages","POST",{
    content:topicMessage(topic,entries,true),allowed_mentions:{parse:[]},
    ...(embeds.length?{embeds}:{})
  });
  await discord(env,"channels/"+channelId+"/messages/"+state.anchor,"PATCH",{
    content:topicMessage(topic,entries),allowed_mentions:{parse:[]},
    ...(embeds.length?{embeds}:{})
  });
}

export async function checkFfxivNews(env: NewsEnv, force = false, publishLatest = false, onePerCategory = false) {
  const cfg = await loadConfig(env);
  if (!cfg.enabled && !force) return {ok:true,status:"disabled",posted:false};
  const checkAt = now();
  const sourceErrors:string[]=[];
  const next:NewsItem[]=[];
  let channelId = "";
  try {
    channelId = await channel(env,cfg);
    const batches: { source:string; items:NewsItem[] }[] = [];
    if (cfg.lodestone) {
      for(const feed of FEEDS) {
        try { batches.push({source:feed.source,items:await lodestone(feed.source,feed.url)}); }
        catch(e:any) {sourceErrors.push(feed.source+": "+String(e.message || e));}
      }
    }
    if (cfg.dalamud) {
      try { batches.push({source:"dalamud",items:await dalamud()}); }
      catch(e:any) { sourceErrors.push("dalamud: "+String(e.message || e)); }
    }
    for(const batch of batches) {
      if (!batch.items.length) continue;
      const baselineKey = "ffxiv_news_baseline_" + batch.source;
      if (await readMeta(env,baselineKey) !== "1") {
        // Existing releases/news must not flood the new Discord channel.
        await saveSeen(env,batch.items);
        await writeMeta(env,baselineKey,"1");
        if (!publishLatest) continue;
      }
      const seen = await seenFor(env,batch.source);
      if (publishLatest) {
        // A conscious operator action: post today's real data once, even if
        // this is the first-ever feed check. Normal automatic checks remain
        // new-items-only and never send the historical backlog.
        next.push(...(batch.source.startsWith("lodestone") ? batch.items.slice(0,4) : batch.items.slice(0,1)));
      } else {
        for(const item of batch.items) if (!seen.has(item.id) && item.date >= Date.now() - 21*86400000) next.push(item);
      }
    }
    if (cfg.fashion) {
      try {
        const item = await fashionReport();
        if (await readMeta(env,"ffxiv_news_baseline_fashion") !== "1") {
          // First successful read establishes the current week as baseline.
          await saveSeen(env,[item]);
          await writeMeta(env,"ffxiv_news_baseline_fashion","1");
          if (publishLatest) next.push(item);
        } else if (publishLatest || !(await seenFor(env,"fashion")).has(item.id)) next.push(item);
      } catch (e:any) {
        sourceErrors.push("fashion: "+String(e?.message || e));
      }
    }
    // Both Lodestone feeds can occasionally reference the same announcement.
    const distinct = new Map<string,NewsItem>();
    for (const item of next) if (!distinct.has(item.url)) distinct.set(item.url,item);
    let selected = [...distinct.values()].sort((a,b)=>b.date-a.date).slice(0,30);
    // A one-time operator-requested demonstration contains one real item
    // from each category, not a back-catalogue or a full historical digest.
    if (onePerCategory) {
      const oneLodestone = selected.find(x => x.source.startsWith("lodestone"));
      selected = [
        ...selected.filter(x => x.source === "fashion").slice(0,1),
        ...selected.filter(x => x.source === "dalamud").slice(0,1),
        ...(oneLodestone ? [oneLodestone] : [])
      ];
    }
    // Each category has exactly one up-to-date starter message in the main
    // channel; old announcements are retained in category-specific threads.
    // Discord archives inactive threads after 24h (without deleting history).
    const delivered:NewsItem[]=[];
    for(const topic of ["fashion","dalamud","lodestone"] as const){
      const entries=selected.filter(item=>newsCategory(item)===topic);
      if(!entries.length) continue;
      try {
        await publishInArchive(env,cfg,channelId,topic,entries);
        // A category that was successfully posted must be marked seen even if
        // another category fails; avoids reposting it on the next daily run.
        await saveSeen(env,entries);
        delivered.push(...entries);
      } catch(e:any) {
        sourceErrors.push("archive-"+topic+": "+String(e?.message || e));
      }
    }
    if(delivered.length) await writeMeta(env,"ffxiv_news_last_post_utc",now());
    await writeMeta(env,"ffxiv_news_last_check_utc",checkAt);
    await writeMeta(env,"ffxiv_news_last_status",sourceErrors.length ? "partial" : "ready");
    await writeMeta(env,"ffxiv_news_last_error",sourceErrors.join(" | ").slice(0,1200));
    return {ok:true,status:sourceErrors.length ? "partial" : "ready",
      posted:delivered.length > 0, items:delivered.length, channel_id:channelId, source_errors:sourceErrors};
  } catch(e:any) {
    const error = String(e?.message || e).slice(0,1000);
    await writeMeta(env,"ffxiv_news_last_check_utc",checkAt);
    await writeMeta(env,"ffxiv_news_last_status","error");
    await writeMeta(env,"ffxiv_news_last_error",error);
    return {ok:false,status:"error",error,channel_id:channelId};
  }
}
// Specific one-time preview authorized by the operator on 21 November 2026.
// Guarded by an atomic D1 claim; it never becomes part of the daily news cycle.
// It only targets a *saved* Discord channel, never auto-creates or guesses one.
const NEWS_TRIAL_KEY = "ffxiv_news_trial_20261121_v1";
async function requestedOneTimePreview(env: NewsEnv, scheduledAt: Date) {
  const t = warsawTime(scheduledAt);
  if (t.day !== "2026-11-21" && t.day !== "2026-11-22") return;
  if (scheduledAt.getUTCMinutes() % 5 !== 0) return;
  const existing = await readMeta(env,NEWS_TRIAL_KEY);
  if (existing) return;
  const cfg = await loadConfig(env);
  if (!cfg.enabled || !cfg.channelId || !idOK(cfg.channelId)) {
    await writeMeta(env,"ffxiv_news_trial_diagnostics","Not sent: news disabled or Discord channel not saved");
    return;
  }
  // Exactly one successful atomic claim wins, even if overlapping cron
  // invocations run. Claim before Discord POST to avoid duplicate messages.
  const claimed = await env.DB.prepare(
    "INSERT INTO meta(key,value) VALUES(?1,'claimed') ON CONFLICT(key) DO NOTHING"
  ).bind(NEWS_TRIAL_KEY).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return;
  const result = await checkFfxivNews(env,true,true,true);
  const outcome = result.ok ? (result.posted ? "sent" : "nothing-sent") : "error";
  await writeMeta(env,NEWS_TRIAL_KEY,outcome);
  await writeMeta(env,"ffxiv_news_trial_diagnostics",JSON.stringify(result).slice(0,1000));
}
export async function scheduleFfxivNews(env: NewsEnv, scheduledAt: Date) {
  await requestedOneTimePreview(env,scheduledAt);
  const t = warsawTime(scheduledAt);
  // One-time provisioning when the feature is deployed: creates (or finds)
  // #ffxiv-news and baselines old RSS/releases without waiting until tomorrow.
  // It is not a recurring 15-minute news poll.
  if (t.hour !== 10 || t.minute !== 0) {
    if (t.minute % 15 !== 0) return;
    if (await readMeta(env,"ffxiv_news_bootstrapped") === "1") return;
    const initial = await checkFfxivNews(env);
    if (initial.ok) await writeMeta(env,"ffxiv_news_bootstrapped","1");
    return;
  }
  // The Worker already has a per-minute cron. Only the 10:00 PL tick fetches
  // sources regularly; no additional schedules or Desktop polling.
  const last = await readMeta(env,"ffxiv_news_last_daily_day");
  if (last === t.day) return;
  const result = await checkFfxivNews(env);
  if (result.ok) {
    await writeMeta(env,"ffxiv_news_last_daily_day",t.day);
    await writeMeta(env,"ffxiv_news_bootstrapped","1");
  }
}
export async function ffxivNewsAdmin(req:Request, env:NewsEnv):Promise<Response> {
  if (req.method === "GET") {
    const cfg = await loadConfig(env);
    return newsJson({ok:true,...cfg, last_check_utc:await readMeta(env,"ffxiv_news_last_check_utc"),
      last_post_utc:await readMeta(env,"ffxiv_news_last_post_utc"),
      status:await readMeta(env,"ffxiv_news_last_status"),
      error:await readMeta(env,"ffxiv_news_last_error"), daily_at:"10:00 Europe/Warsaw"});
  }
  if (req.method === "PUT") {
    let x:any;
    try { x = await req.json(); } catch { return newsJson({error:"invalid JSON"},400); }
    const prev = await loadConfig(env);
    const guildId = x.guildId === undefined ? prev.guildId : String(x.guildId).trim();
    const channelId = x.channelId === undefined ? prev.channelId : String(x.channelId).trim();
    if (!idOK(guildId) || (channelId && !idOK(channelId))) return newsJson({error:"invalid guild or channel ID"},400);
    const cfg:NewsConfig = {guildId,channelId,
      enabled: x.enabled === undefined ? prev.enabled : x.enabled === true,
      fashion: x.fashion === undefined ? prev.fashion : x.fashion === true,
      dalamud: x.dalamud === undefined ? prev.dalamud : x.dalamud === true,
      lodestone: x.lodestone === undefined ? prev.lodestone : x.lodestone === true
    };
    if (cfg.guildId !== prev.guildId || cfg.channelId !== prev.channelId) {
      if (cfg.channelId) {
        const selected = await discord(env,"channels/"+cfg.channelId);
        if (selected.guild_id !== cfg.guildId || ![0,5].includes(Number(selected.type)))
          return newsJson({error:"channel does not belong to the server"},400);
      }
    }
    await writeMeta(env,"ffxiv_news_config_v1",JSON.stringify(cfg));
    return newsJson({ok:true,...cfg, daily_at:"10:00 Europe/Warsaw"});
  }
  if (req.method === "POST") {
    let x:any = {};
    try {x=await req.json();}catch{}
    if (x.action === "test") {
      try {
        const cfg = await loadConfig(env);
        const id = await channel(env,cfg);
        await discord(env,"channels/"+id+"/messages","POST",{content:"✅ **YURA FFXIV NEWS** • test kanału. Automatyczne sprawdzanie: codziennie o 10:00 czasu polskiego.",allowed_mentions:{parse:[]}});
        return newsJson({ok:true,status:"test-sent",channel_id:id});
      } catch(e:any) {return newsJson({ok:false,error:String(e.message || e)},502);}
    }
    const result = await checkFfxivNews(env,true,x.action === "publish-latest");
    return newsJson(result,result.ok?200:502);
  }
  return newsJson({error:"method not allowed"},405);
}
