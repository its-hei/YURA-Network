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
    headers: { "accept": "application/rss+xml, application/xml, application/json, text/html",
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
  const xml = await fetchText(url);
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].slice(0,35);
  if (!items.length) throw new Error("Lodestone RSS: no entries (" + source + ")");
  return items.map(m => {
    const title = tag(m[1],"title");
    const link = tag(m[1],"link").replace(/^http:\/\//,"https://");
    const published = Date.parse(tag(m[1],"pubDate")) || Date.now();
    const uid = tag(m[1],"guid") || link;
    if (!title || !/^https:\/\/(?:eu|na)\.finalfantasyxiv\.com\/lodestone\//i.test(link)) return null;
    return { source, id: uid.slice(0,400), title:title.slice(0,200), url:link, date:published };
  }).filter((item):item is NewsItem => Boolean(item));
}
async function dalamud(): Promise<NewsItem[]> {
  const raw = await fetchText("https://api.github.com/repos/goatcorp/Dalamud/releases?per_page=20");
  const releases:any = JSON.parse(raw);
  if (!Array.isArray(releases)) throw new Error("Dalamud GitHub releases are not an array");
  return releases.filter((r:any) => r && !r.draft && !r.prerelease && r.tag_name && r.html_url)
    .slice(0,15).map((r:any) => ({
      source:"dalamud", id:clamp(r.id || r.tag_name,200),
      title:clamp(r.name || ("Dalamud " + r.tag_name),200),
      url:String(r.html_url), date:Date.parse(String(r.published_at ?? "")) || Date.now()
    }));
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
  const today = warsawTime(new Date());
  let image: string | undefined;
  try {
    const html = await fetchText(url);
    const imgs = [...html.matchAll(/<img\b[^>]*>/gi)];
    const target = imgs.find(x => /Fashion Report Image/i.test(x[0]))?.[0] || "";
    const attr = target.match(/\b(?:src|data-src)=["']([^"']+)["']/i);
    if (attr) {
      const resolved = new URL(attr[1],url);
      if (resolved.protocol === "https:" && /\.(png|jpg|jpeg|webp)(?:$|\?)/i.test(resolved.pathname)) image = resolved.toString();
    }
  } catch { /* Do not claim the image exists unless fetched from the publisher. */ }
  return { source:"fashion", id:"fashion-"+today.day, date:Date.now(),
    title:"Fashion Report • sprawdź rozwiązanie tygodnia (80 punktów / MGP)", url, ...(image ? {image} : {}) };
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
function linesFor(items:NewsItem[]): string {
  const by = (source:string) => items.filter(x => x.source===source);
  const output = ["**📰 FFXIV NEWS • YURA**", "Nowe informacje z ostatniego sprawdzenia:", ""];
  const fashion = by("fashion");
  if (fashion.length) {
    output.push("**👗 Fashion Report**");
    for(const x of fashion) output.push("• [Sprawdź rozwiązanie tygodnia]("+x.url+")");
    output.push("");
  }
  const dal = by("dalamud");
  if (dal.length) {
    output.push("**🟢 Dalamud • aktualizacje stabilne**");
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
export async function checkFfxivNews(env: NewsEnv, force = false) {
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
        continue;
      }
      const seen = await seenFor(env,batch.source);
      for(const item of batch.items) if (!seen.has(item.id) && item.date >= Date.now() - 21*86400000) next.push(item);
    }
    const local = warsawTime(new Date());
    if (cfg.fashion && local.weekday === "Fri") {
      const item = await fashionReport();
      if (!(await seenFor(env,"fashion")).has(item.id)) next.push(item);
    }
    const selected = next.sort((a,b)=>b.date-a.date).slice(0,30);
    if (selected.length) {
      const image = selected.find(x=>x.source==="fashion" && x.image)?.image;
      await discord(env,"channels/"+channelId+"/messages","POST",{
        content:linesFor(selected),allowed_mentions:{parse:[]},
        ...(image ? {embeds:[{image:{url:image}}]} : {})
      });
      await saveSeen(env,selected);
      await writeMeta(env,"ffxiv_news_last_post_utc",now());
    }
    await writeMeta(env,"ffxiv_news_last_check_utc",checkAt);
    await writeMeta(env,"ffxiv_news_last_status",sourceErrors.length ? "partial" : "ready");
    await writeMeta(env,"ffxiv_news_last_error",sourceErrors.join(" | ").slice(0,1200));
    return {ok:true,status:sourceErrors.length ? "partial" : "ready",
      posted:selected.length > 0, items:selected.length, channel_id:channelId, source_errors:sourceErrors};
  } catch(e:any) {
    const error = String(e?.message || e).slice(0,1000);
    await writeMeta(env,"ffxiv_news_last_check_utc",checkAt);
    await writeMeta(env,"ffxiv_news_last_status","error");
    await writeMeta(env,"ffxiv_news_last_error",error);
    return {ok:false,status:"error",error,channel_id:channelId};
  }
}
export async function scheduleFfxivNews(env: NewsEnv, scheduledAt: Date) {
  const t = warsawTime(scheduledAt);
  if (t.hour !== 10 || t.minute !== 0) return;
  // The Worker already has a per-minute cron. No additional schedules or Desktop polling.
  const last = await readMeta(env,"ffxiv_news_last_daily_day");
  if (last === t.day) return;
  const result = await checkFfxivNews(env);
  if (result.ok) await writeMeta(env,"ffxiv_news_last_daily_day",t.day);
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
    const result = await checkFfxivNews(env,true);
    return newsJson(result,result.ok?200:502);
  }
  return newsJson({error:"method not allowed"},405);
}
