// Four persistent, editable Discord messages: EVENT, FASHION, PATCH, DALAMUD.
// Every announcement's previous version goes into that message's history
// thread before the main message is edited. No daily no-news posts.
import type {LiveEvent} from "./ffxiv-events";
import {discordFfxivRequest} from "./ffxiv-discord-api.ts";

interface Env {DB:D1Database; DISCORD_BOT_TOKEN?:string}
export type SourceItem={source:string;id:string;title:string;url:string;date:number;image?:string;imageProxy?:string};
export type Sources={
  fashion?:SourceItem;patch?:SourceItem;dalamud?:SourceItem;events:LiveEvent[]|null;
};
export type BoardConfig={guildId:string;channelId:string;fashion:boolean;events:boolean;dalamud:boolean;lodestone:boolean};
type Category="event"|"fashion"|"patch"|"dalamud";
type Current={id:string;title:string;url:string;end?:number;image?:string;imageProxy?:string;expires?:number};
type Post={anchor:string;thread:string;current:Current|null;retiredId?:string;renderRevision?:number};
const RENDER_REVISION=13;
const ORDER:Category[]=["event","fashion","patch","dalamud"];
const LABEL:Record<Category,string>={
  event:"🎉 AKTUALNY EVENT",fashion:"👗 FASHION REPORT",
  patch:"⚔️ AKTUALNY PATCH",dalamud:"🟢 DALAMUD • WERSJA STABILNA"
};
// Distinct Discord embed stripes, with emoji fallbacks in plain text.
export const FFXIV_CARD_PALETTE:Record<Category,{color:number;marker:string}>={
  event:{color:0xF5A544,marker:"🟠"},
  fashion:{color:0xD976BD,marker:"🟣"},
  patch:{color:0x5CA9F5,marker:"🔵"},
  dalamud:{color:0x43C6A2,marker:"🟢"}
};
const LEGACY:Partial<Record<Category,string>>={
  fashion:"fashion",patch:"lodestone",dalamud:"dalamud"
};
const ID=/^\d{15,22}$/;
const NO_PINGS={parse:[]};
const keyFor=(cfg:BoardConfig,category:Category)=>"ffxiv_board_v3_"+cfg.guildId+"_"+cfg.channelId+"_"+category;
const canonical=(category:Category)=>"**"+LABEL[category]+"**";
const safe=(v:unknown,n=160)=>String(v??"").replace(/[\r\n]/g," ").slice(0,n);
function eventEndPoland(time?:number):string {
  if(!time||!Number.isFinite(time))return "termin nieznany";
  return new Intl.DateTimeFormat("pl-PL",{
    timeZone:"Europe/Warsaw",day:"numeric",month:"long",year:"numeric",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).format(new Date(time));
}
function fashionResetLabel(expires?:number):string {
  if(!expires || !Number.isFinite(expires))return "👗 Reset: termin nieznany";
  // Use Poland's wall clock time (winter/summer DST) rather than UTC or
  // Discord's viewer-dependent timestamp formatting.
  const pl=new Intl.DateTimeFormat("pl-PL",{
    timeZone:"Europe/Warsaw",day:"numeric",month:"long",year:"numeric",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  });
  return "👗 Reset: "+pl.format(new Date(expires));
}

// Discord can re-sign its own CDN media references when they are used inside
// embeds. Cloudflare Workers, however, are sometimes blocked (HTTP 403) from
// downloading the same attachment. Use an embed URL independently of upload.
export function publicFashionImageUrl(value:string):string {
  try {
    const u=new URL(value);
    if(u.protocol!=="https:")return "";
    const hosts=new Set(["cdn.discordapp.com","media.discordapp.net",
      "images-ext-1.discordapp.net","images-ext-2.discordapp.net",
      "fashionreportxiv.com"]);
    if(!hosts.has(u.hostname))return "";
    if(u.hostname!=="fashionreportxiv.com" &&
       !u.pathname.startsWith("/attachments/"))return "";
    if(!/\.(?:png|jpe?g|webp)$/i.test(u.pathname))return "";
    if(u.hostname!=="fashionreportxiv.com"){
      // Discord documentation recommends passing unsigned attachment paths
      // into embed image URLs; Discord refreshes the URL server-side.
      u.searchParams.delete("ex");
      u.searchParams.delete("is");
      u.searchParams.delete("hm");
    }
    return u.toString();
  }catch{return "";}
}

function validCurrent(v:any):v is Current {
  return !!v && typeof v.id==="string" && typeof v.title==="string" &&
    typeof v.url==="string" && /^https:\/\//.test(v.url);
}
async function getMeta(env:Env,key:string):Promise<string>{
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value??"");
}
async function putMeta(env:Env,key:string,value:string):Promise<void>{
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value).run();
}
const api=discordFfxivRequest;
async function loadPost(env:Env,cfg:BoardConfig,category:Category):Promise<Post|null>{
  try {
    const obj=JSON.parse(await getMeta(env,keyFor(cfg,category))||"null");
    if(obj && ID.test(obj.anchor) && ID.test(obj.thread) &&
      (obj.current===null || validCurrent(obj.current))) return obj as Post;
  }catch{}
  return null;
}
async function savePost(env:Env,cfg:BoardConfig,category:Category,value:Post):Promise<void>{
  await putMeta(env,keyFor(cfg,category),JSON.stringify(value));
}
function nextTuesdayResetUTC(time:number):number {
  const d=new Date(time), next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),8));
  const days=(2-next.getUTCDay()+7)%7;
  next.setUTCDate(next.getUTCDate()+days);
  if(next.getTime()<=time)next.setUTCDate(next.getUTCDate()+7);
  return next.getTime();
}
function toCurrent(category:Category,item:SourceItem|LiveEvent|undefined,at:number):Current|null{
  if(!item)return null;
  if(category==="event"){
    const e=item as LiveEvent;
    if(!Number.isFinite(e.start)||!Number.isFinite(e.end)||e.end<=at||e.start>at)return null;
    return {id:e.url+"-"+e.start+"-"+e.end,title:e.title,url:e.url,end:e.end,...(e.image?{image:e.image}:{})};
  }
  const x=item as SourceItem;
  return {id:x.id,title:x.title,url:x.url,
    ...(category==="fashion"?{expires:nextTuesdayResetUTC(at)}:{}),
    ...(x.image?{image:x.image}:{}),
    ...(x.imageProxy?{imageProxy:x.imageProxy}:{})};
}
function eventCurrent(events:LiveEvent[]|null,at:number):Current|null{
  const active=events?.filter(e=>e.start<=at&&at<e.end).sort((a,b)=>b.start-a.start)[0];
  return toCurrent("event",active,at);
}
export function renderFfxivCardText(category:Category,x:Current|null):string {
  const header=FFXIV_CARD_PALETTE[category].marker+" "+canonical(category);
  // Discord may suppress rich embeds due to permissions or client settings.
  // All essential information MUST be in regular content, not embed-only.
  if(!x){
    return header+"\n_"+(
      category==="event"?"Brak potwierdzonego trwającego eventu.":
      category==="fashion"?"Oczekujemy na następny Fashion Report.":
      category==="patch"?"Czekamy na oficjalne patch notes.":
      "Nie udało się ustalić stabilnej wersji.")+"_";
  }
  const title=safe(x.title,170).replace(/[*\x60]/g,"");
  const link=(label:string)=>"["+label+"]("+x.url+")";
  const date=(time?:number)=>time&&Number.isFinite(time)
    ? "<t:"+Math.floor(time/1000)+":f>":"brak terminu";
  switch(category){
    case "event":
      // Compact clickable headline above the ORIGINAL source preview.
      // The deadline and countdown remain inside that preview.
      return link(/FFXVI|Final Fantasy XVI/i.test(title)&&/Crossover Event Returns/i.test(title)
        ?"FF XIV x FF XVI Crossover Event Returns!":title);
    case "fashion":
      // Plain bot content can display a masked link as raw Markdown;
      // the real clickable link is the Fashion embed's title+URL.
      return "";
    case "patch":
      return [header,"**"+title+"**",link("Przeczytaj patch notes")].join("\n");
    case "dalamud":
      return [header,"**"+title+"**",link("Wersja stabilna • źródło")].join("\n");
  }
}
const textFor=renderFfxivCardText;

function embedsFor(category:Category,x:Current|null):unknown[]{
  if(!x)return [];
  const source:Record<Category,string>={
    event:"Lodestone • wydarzenia",fashion:"Fashion Reporter • Discord",
    patch:"Lodestone • patch notes",dalamud:"Dalamud Distribution"
  };
  const at=(time?:number)=>time&&Number.isFinite(time)?"<t:"+Math.floor(time/1000)+":f>":"";
  let title=safe(x.title,180);
  let description="";
  switch(category){
    case "event":
      // Restore the former official Lodestone preview and its optional art.
      if(/FFXVI|Final Fantasy XVI/i.test(title)&&/Crossover Event Returns/i.test(title))
        title="The Path Infernal • FFXIV × FFXVI";
      description="**Trwa teraz** • koniec: "+eventEndPoland(x.end)+
        (x.end?" • <t:"+Math.floor(x.end/1000)+":R>":"");
      if(x.url.includes("/ffxvi/")||/FFXVI|Final Fantasy XVI/i.test(x.title))
        description+="\nNagrody: Torgal (mount), Metian Attire, Torgal Pup.";
      break;
    case "fashion":
      title=fashionResetLabel(x.expires);
      description="";
      break;
    case "patch":
      description="Oficjalne informacje o aktualizacji FFXIV.";
      break;
    case "dalamud":
      title=safe(x.title.replace(/^Dalamud\s*/i,""),100);
      description="Aktualnie dostępna stabilna wersja Dalamuda.";
      break;
  }
  const embed:any={
    color:FFXIV_CARD_PALETTE[category].color,title,
    url:category==="fashion"?"https://fashionreportxiv.com/":x.url,
    ...(description.trim()?{description:description.trim()}:{}),
    ...(category==="fashion"?{}:{footer:{text:"Źródło: "+source[category]}})
  };
  if(x.image){
    try {
      const img=new URL(x.image);
      if(img.protocol==="https:"&&(
        (category==="fashion"&&(
          img.hostname==="fashionreportxiv.com" ||
          ["cdn.discordapp.com","media.discordapp.net","images-ext-1.discordapp.net","images-ext-2.discordapp.net"].includes(img.hostname)
        ))||
        (category==="event"&&/(?:^|\.)finalfantasyxiv\.com$/.test(img.hostname))))
        embed.image={url:category==="fashion"?publicFashionImageUrl(x.image)||img.toString():img.toString()};
    }catch{}
  }
  // Linked reset title and attached infographic render as a single card.
  return [embed];
}
export const renderFfxivCardEmbeds=embedsFor;
function changed(a:Current|null,b:Current|null):boolean{
  // Ignore fetched-at timestamps and cache-busting changes. Expiry is a
  // property of the weekly instance, not a reason to republish daily.
  return a?.id!==b?.id || a?.url!==b?.url;
}
async function ensurePost(env:Env,cfg:BoardConfig,cat:Category,existing:any[]):Promise<Post>{
  const saved=await loadPost(env,cfg,cat);
  // Saved post/thread snowflakes are stable. Do not re-fetch eight objects
  // on every check: Discord's per-channel GET bucket is shared with other
  // operations and repeatedly hit HTTP 429. A failed edit/archival still
  // surfaces an error without creating duplicate posts.
  if(saved)return saved;
  const found=existing.find(m=>m.author?.bot===true && (
    String(m.content??"").startsWith(canonical(cat)) ||
    String(m.content??"").startsWith(FFXIV_CARD_PALETTE[cat].marker+" "+canonical(cat)) ||
    (cat==="fashion" && (
      /^\[👗 Reset: /.test(String(m.content??"")) ||
      (Array.isArray(m.embeds) && m.embeds.some((e:any)=>
        /^👗 Reset: /.test(String(e?.title??""))))
    ))
  ));
  const anchor=found?.id;
  let id=ID.test(String(anchor??""))?String(anchor):"";
  if(!id){
    const created=await api(env,"channels/"+cfg.channelId+"/messages","POST",{
      content:canonical(cat)+"\nŁadowanie aktualnych danych…",allowed_mentions:NO_PINGS
    });
    id=String(created?.id??"");
    if(!ID.test(id))throw new Error("Discord did not return "+cat+" message id");
  }
  let thread="";
  try{
    const t=await api(env,"channels/"+id);
    if([11,12].includes(Number(t.type)) && t.parent_id===cfg.channelId) thread=String(t.id);
  }catch{}
  if(!ID.test(thread)){
    const created=await api(env,"channels/"+cfg.channelId+"/messages/"+id+"/threads","POST",{
      name:"📁 "+LABEL[cat]+" — historia",auto_archive_duration:1440
    });
    thread=String(created?.id??"");
  }
  if(!ID.test(thread))throw new Error("Discord did not return "+cat+" history thread");
  // An existing state already returned above; a genuinely new post has
  // no previous content to archive.
  const state:Post={anchor:id,thread,current:null};
  await savePost(env,cfg,cat,state);
  return state;
}

// Upload a permanent copy of a Fashion infographic to the Discord post.
// A native attachment displays even if rich link embeds are suppressed and
// avoids expiring signed source URLs in archived weekly reports.
const FASHION_IMAGE_HOSTS=new Set([
  "fashionreportxiv.com","www.fashionreportxiv.com",
  "cdn.discordapp.com","media.discordapp.net",
  "images-ext-1.discordapp.net","images-ext-2.discordapp.net"
]);
async function downloadFashionImage(url:string, weekStart?:number, verifiedWeek=false):
Promise<{blob:Blob;filename:string}> {
  const uri=new URL(url);
  if(uri.protocol!=="https:" || !FASHION_IMAGE_HOSTS.has(uri.hostname))
    throw new Error("Image host is not an approved Fashion source");
  // Cloudflare Workers supports only redirect:"follow" or "manual".
  // redirect:"error" rejects BEFORE the HTTP request is even made,
  // which previously broke ALL Fashion images (including publisher).
  // Follow at most two redirects, each restricted to our image hosts.
  let target=uri;
  let response:Response|undefined;
  for(let hop=0;hop<3;hop++){
    response=await fetch(target.toString(),{
      headers:{accept:"image/png,image/jpeg,image/webp"},
      redirect:"manual",
      signal:AbortSignal.timeout(8000)
    });
    if(response.status<300 || response.status>=400)break;
    const location=response.headers.get("location");
    if(!location || hop===2)throw new Error("Fashion image redirect could not be validated");
    const next=new URL(location,target);
    if(next.protocol!=="https:" || !FASHION_IMAGE_HOSTS.has(next.hostname))
      throw new Error("Fashion image redirect to unapproved host");
    target=next;
  }
  if(!response)throw new Error("Fashion source request was not performed");
  if(!response.ok)throw new Error("Fashion image "+uri.hostname+" HTTP "+response.status);
  const mime=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  const extension=mime==="image/png"?"png":mime==="image/jpeg"?"jpg":mime==="image/webp"?"webp":"";
  if(!extension)throw new Error("Fashion source did not return a supported image");
  if(weekStart!==undefined) {
    // Fallback uses this same publisher's public guide, but ONLY when its
    // HTTP last-modified date confirms it belongs to this current week.
    // Never show a stale Week 459 solution as Week 460.
    const modified=Date.parse(response.headers.get("last-modified")||"");
    if(Number.isFinite(modified)){
      if(modified<weekStart || modified>Date.now()+86400000)
        throw new Error("Publisher Last-Modified shows an outdated weekly guide");
    }else if(!verifiedWeek){
      throw new Error("Publisher date missing and report week not verified");
    }
  }
  const length=Number(response.headers.get("content-length")||0);
  if(length>8*1024*1024)throw new Error("Fashion image exceeds 8 MB");
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength<9000 || bytes.byteLength>8*1024*1024)
    throw new Error("Fashion image has invalid size");
  return {blob:new Blob([bytes],{type:mime}),filename:"fashion-report."+extension};
}
// The Fashion Reporter art for week 460 is independently confirmed on
// fashionreportxiv.com/hint.png for 21 November 2026. New Friday reports
// must agree with the current Tuesday-reset week before the public image
// is allowed as a backup. Never assume an old guide is a new one.
const WEEK_460_RESET=Date.UTC(2026,10,24,8);
const WEEK_MS=7*86400000;
function verifiedReportWeek(reportId:string,expires?:number):number|null {
  if(!expires)return null;
  const delta=(expires-WEEK_460_RESET)/WEEK_MS;
  if(!Number.isInteger(delta) || delta<0)return null;
  const currentWeek=460+delta;
  const weekMatch=/^discord-fashion-week-(\d{3,4})$/.exec(reportId);
  if(weekMatch)return Number(weekMatch[1])===currentWeek?currentWeek:null;
  // One and only one manually introduced initial report: Week 460.
  if(currentWeek===460 && /^discord-fashion-manual-\d{15,22}$/.test(reportId)
      && Date.now()<WEEK_460_RESET)return 460;
  return null;
}
async function digestImage(blob:Blob):Promise<string>{
  const bytes=await blob.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
type FashionDownload={blob:Blob;filename:string;publisherWeek?:number;publisherHash?:string};
async function fashionAttachment(env:Env,url:string,expires?:number,proxyUrl?:string,
  reportId=""):Promise<FashionDownload> {
  try{return await downloadFashionImage(url);}
  catch(originalError:any){
    // The Discord media proxy often has different edge access from the
    // signed CDN URL. It is sourced from the same attachment in Discord API.
    if(proxyUrl && proxyUrl!==url){
      try{return await downloadFashionImage(proxyUrl);}
      catch {/* continue to verified publisher fallback */}
    }
    const src=publicFashionImageUrl(url);
    if(!src || !new URL(src).hostname.endsWith("discordapp.com") &&
       !new URL(src).hostname.endsWith("discordapp.net"))throw originalError;
    // Cloudflare Workers cannot always read Discord's attachment CDN even
    // when Discord itself displays it. If the same publisher's public
    // weekly PNG is provably current, use that image as a last-resort
    // native attachment; this does not affect week detection or source ID.
    if(!expires)throw originalError;
    const beginning=expires-7*86400000;
    const verifiedWeek=verifiedReportWeek(reportId,expires);
    try {
      const backup=await downloadFashionImage(
        "https://fashionreportxiv.com/hint.png",beginning,verifiedWeek!==null);
      if(verifiedWeek!==null){
        const hash=await digestImage(backup.blob);
        const lastRaw=await getMeta(env,"ffxiv_fashion_publisher_backup_last_v1");
        let last:{week:number;hash:string}|null=null;
        try{last=JSON.parse(lastRaw||"null");}catch{}
        if(last && last.week!==verifiedWeek && last.hash===hash)
          throw new Error("Backup image is unchanged from previous Fashion week");
        return {...backup,publisherWeek:verifiedWeek,publisherHash:hash};
      }
      return backup;
    } catch(fallbackError:any) {
      throw new Error("Discord source unavailable ("+
        String(originalError?.message||originalError).slice(0,60)+
        "); current-week image backup unavailable ("+
        String(fallbackError?.message||fallbackError).slice(0,80)+")");
    }
  }
}

type DiscordCardPayload={content:string;embeds:unknown[];allowed_mentions:{parse:never[]};attachments?:unknown[]};
export async function deliverCard(
  env:Env,path:string,method:"PATCH"|"POST",category:Category,x:Current|null,
  warnings:string[],oldMessage?:any,archive=false
):Promise<boolean>{
  const content=(archive?"📁 Poprzednia informacja\n":"")+textFor(category,x);
  const payload:DiscordCardPayload={content,embeds:embedsFor(category,x),
    allowed_mentions:NO_PINGS,attachments:[]};
  if(category==="fashion" && x?.image){
    // For a layout-only migration, reuse a previously uploaded file when
    // possible. Discord requires listing retained attachments on message edits.
    const oldAttachment=Array.isArray(oldMessage?.attachments)
      ? oldMessage.attachments.find((a:any)=>String(a.filename||"").startsWith("fashion-report."))
      : null;
    if(method==="PATCH" && oldAttachment?.id){
      payload.attachments=[{id:String(oldAttachment.id),filename:String(oldAttachment.filename)}];
      const rich=payload.embeds[0] as any;
      // Reuse the native attachment inside the linked embed: one image only.
      if(rich)rich.image={url:"attachment://"+String(oldAttachment.filename)};
      await api(env,path,method,payload);
      return true;
    }
    try{
      const image=await fashionAttachment(env,x.image,x.expires,x.imageProxy,x.id);
      const multipart=new FormData();
      const rich=payload.embeds[0] as any;
      if(rich)rich.image={url:"attachment://"+image.filename};
      payload.attachments=[{id:0,filename:image.filename,description:"Fashion Report • rozwiązanie tygodnia"}];
      multipart.append("payload_json",JSON.stringify(payload));
      multipart.append("files[0]",image.blob,image.filename);
      const response=await api(env,path,method,multipart);
      let attachments=Array.isArray(response?.attachments)?response.attachments:[];
      if(!attachments.length && method==="PATCH"){
        // The edit can be applied even when Discord's response omits the
        // attachment list. Verify it before considering the upload failed.
        const live=await api(env,path);
        attachments=Array.isArray(live?.attachments)?live.attachments:[];
      }
      if(!attachments.some((a:any)=>String(a.filename||"").startsWith("fashion-report.")))
        throw new Error("Discord did not confirm the attached infographic");
      // Successful Discord upload is independent of whether D1 can write
      // diagnostics: never roll back an uploaded file due to D1 errors.
      try{
        if(image.publisherWeek!==undefined && image.publisherHash)
          await putMeta(env,"ffxiv_fashion_publisher_backup_last_v1",
            JSON.stringify({week:image.publisherWeek,hash:image.publisherHash}));
        await putMeta(env,"ffxiv_fashion_media_status_v1",
          "OK • plik "+image.filename+" zapisany w wiadomości Discorda");
      }catch{/* Do not remove a successfully uploaded image. */}
      return true;
    }catch(e:any){
      // Discord's CDN often rejects direct Cloudflare Worker downloads with
      // HTTP 403. Keep the full original art referenced by the embed as an
      // UNSIGNED Discord CDN URL, and provide a clickable image link in the
      // message body. Do not replace a successfully uploaded attachment with
      // a JSON PATCH just because its response omitted attachment metadata.
      const reason="fashion attachment: "+String(e?.message||e).slice(0,175);
      warnings.push(reason);
      try{await putMeta(env,"ffxiv_fashion_media_status_v1",reason);}
      catch{/* Preserve the original Discord error for the API caller. */}
      payload.embeds=embedsFor(category,x);
      payload.attachments=[];
      await api(env,path,method,payload);
      return false;
    }
  }
  await api(env,path,method,payload);
  return true;
}

async function threadWrite(env:Env,threadId:string,category:Category,old:Current,warnings:string[]):Promise<void>{
  const t=await api(env,"channels/"+threadId);
  if(t.thread_metadata?.archived){
    if(t.thread_metadata?.locked)throw new Error("Archive thread locked: "+category);
    await api(env,"channels/"+threadId,"PATCH",{archived:false});
  }
  await deliverCard(env,"channels/"+threadId+"/messages","POST",category,old,warnings,undefined,true);
}
async function rollover(env:Env,cfg:BoardConfig,cat:Category,post:Post,fresh:Current|null,warnings:string[]=[]):Promise<boolean>{
  if(!changed(post.current,fresh)) {
    // After the compact layout was reconciled once, unchanged news requires
    // zero Discord API calls. In particular, no request is made at 10:00
    // just to redisplay already-current Fashion, Patch or Dalamud data.
    if(post.renderRevision===RENDER_REVISION)return false;
    const displayed=await api(env,"channels/"+cfg.channelId+"/messages/"+post.anchor);
    const wanted=textFor(cat,post.current);
    const expectedEmbeds=embedsFor(cat,post.current);
    const actualEmbeds=Array.isArray(displayed.embeds)?displayed.embeds:[];
    // Recover missing/unreadable preview images, and convert old long raw
    // links into the compact one-embed layout exactly once.
    const hasCurrentEmbed=expectedEmbeds.length===0 || (
      actualEmbeds.length===1 &&
      actualEmbeds[0]?.title===(expectedEmbeds[0] as any)?.title &&
      actualEmbeds[0]?.description===(expectedEmbeds[0] as any)?.description &&
      Number(actualEmbeds[0]?.color)===Number((expectedEmbeds[0] as any)?.color) &&
      (!((expectedEmbeds[0] as any)?.image) || !!actualEmbeds[0]?.image)
    );
    const hasFashionAttachment=cat!=="fashion" || !post.current?.image ||
      (Array.isArray(displayed.attachments) &&
       displayed.attachments.some((a:any)=>String(a.filename||"").startsWith("fashion-report.")));
    // A colored rich embed alone is not evidence that the source image
    // exists on Discord; require a native attachment as well.
    if(displayed.content!==wanted || !hasCurrentEmbed ||
       actualEmbeds.length!==expectedEmbeds.length || !hasFashionAttachment){
      const imageOK=await deliverCard(env,"channels/"+cfg.channelId+"/messages/"+post.anchor,
        "PATCH",cat,post.current,warnings,displayed);
      await savePost(env,cfg,cat,{...post,current:fresh,renderRevision:imageOK?RENDER_REVISION:0});
      return true;
    }
    await savePost(env,cfg,cat,{...post,current:fresh,renderRevision:RENDER_REVISION});
    return false;
  }
  const old=post.current;
  if(old){
    // The old item is copied BEFORE the main post is edited. This is how
    // Discord can offer history, since it has no "move message" API.
    const archivedKey=keyFor(cfg,cat)+"_archived_"+encodeURIComponent(old.id).slice(0,300);
    // Switching this week's card from the former web image to the
    // user's manually uploaded Discord image is a change of artwork
    // provider, NOT a completed Fashion Report week. Do not create
    // a duplicate historical week just because the source changed.
    const sameWeekSourceSwitch=cat==="fashion" && !!fresh &&
      old.id.startsWith("image-sha256-") &&
      fresh.id.startsWith("discord-fashion-");
    if(!sameWeekSourceSwitch && await getMeta(env,archivedKey)!=="1"){
      await threadWrite(env,post.thread,cat,old,warnings);
      await putMeta(env,archivedKey,"1");
    }
  }
  const imageOK=await deliverCard(env,"channels/"+cfg.channelId+"/messages/"+post.anchor,
    "PATCH",cat,fresh,warnings);
  const next={...post,current:fresh,renderRevision:imageOK?RENDER_REVISION:0,
    ...(cat==="fashion" && old && !fresh?{retiredId:old.id}:{})};
  await savePost(env,cfg,cat,next);
  return true;
}
async function oldAnchors(env:Env,cfg:BoardConfig,cat:Category,post:Post):Promise<void>{
  // A cautious migration from the previous 3-message layout. Only bot-owned
  // old-category anchor messages are candidates. Never touch other messages
  // or a thread with user discussion.
  const legacyCat=LEGACY[cat];
  if(!legacyCat)return;
  const key="ffxiv_news_archive_v1_"+cfg.guildId+"_"+cfg.channelId+"_"+legacyCat;
  const finished="ffxiv_board_v3_legacy_finished_"+cfg.channelId+"_"+legacyCat;
  if(await getMeta(env,finished)==="1")return;
  let old:{anchor:string;thread:string}|null=null;
  try{old=JSON.parse(await getMeta(env,key)||"null");}catch{}
  if(!old || !ID.test(String(old.anchor))||old.anchor===post.anchor){
    await putMeta(env,finished,"1");return;
  }
  try{
    const m=await api(env,"channels/"+cfg.channelId+"/messages/"+old.anchor);
    const prefixes:Record<string,string>={
      fashion:"**👗 FASHION REPORT • AKTUALNE**",
      dalamud:"**🟢 DALAMUD • STABLE**",
      lodestone:"**⚔️ FINAL FANTASY XIV • AKTUALNOŚCI**"
    };
    if(!m.author?.bot || !String(m.content??"").startsWith(prefixes[legacyCat]))return;
    const own=await api(env,"users/@me");
    if(m.author.id!==own.id)return;

    // Copy history backwards until there are no more records. Cap at 500 to
    // prevent accidental mass migration; leave the old thread intact if a
    // community member has replied or anything is incomplete.
    const collected:any[]=[];
    let before="";
    for(let page=0;page<6;page++){
      const messages:any=await api(env,"channels/"+old.thread+"/messages?limit=100"+(before?"&before="+before:""));
      if(!Array.isArray(messages))throw new Error("History messages unavailable");
      collected.push(...messages);
      if(messages.some((x:any)=>x.author?.id!==own.id))return;
      if(messages.length<100)break;
      before=String(messages[messages.length-1].id);
      if(page===5)return;
    }
    for(const item of collected.reverse()){
      const sentKey="ffxiv_board_v3_migrated_"+cat+"_"+String(item.id);
      if(await getMeta(env,sentKey)==="1")continue;
      const attachments=(item.attachments||[]).map((a:any)=>String(a.url||"")).filter((x:string)=>/^https:\/\//.test(x));
      const embeds=(item.embeds||[]).map((a:any)=>String(a.image?.url||"")).filter((x:string)=>/^https:\/\//.test(x));
      const lines=["📁 Poprzednia historia ("+LABEL[cat]+")",
        String(item.content||"").slice(0,1200),...attachments,...embeds];
      const t=await api(env,"channels/"+post.thread);
      if(t.thread_metadata?.archived)await api(env,"channels/"+post.thread,"PATCH",{archived:false});
      await api(env,"channels/"+post.thread+"/messages","POST",{content:lines.join("\n").slice(0,1900),allowed_mentions:NO_PINGS});
      await putMeta(env,sentKey,"1");
    }
    // Preserve an old main post if it contained actual news. Placeholder
    // messages contain no history and are safe to replace.
    const body=String(m.content??"");
    if(!body.includes("Nowe wiadomości pojawią się w tym poście.")){
      const t=await api(env,"channels/"+post.thread);
      if(t.thread_metadata?.archived)await api(env,"channels/"+post.thread,"PATCH",{archived:false});
      await api(env,"channels/"+post.thread+"/messages","POST",{
        content:"📁 Poprzednia informacja\n"+body.slice(0,1800),allowed_mentions:NO_PINGS
      });
    }
    await api(env,"channels/"+cfg.channelId+"/messages/"+old.anchor,"DELETE");
    await putMeta(env,finished,"1");
  }catch{
    // On any permission, rate-limit or archival error, preserve the old
    // anchor/thread unchanged instead of risking lost history.
  }
}

// Remove ONLY the obsolete, EMPTY bot placeholders from the old three-card
// layout. This is not bulk message deletion: real news, human discussions
// and threads with any content are preserved. Discord has no move API.
async function cleanupLegacyPlaceholders(env:Env,cfg:BoardConfig,visible:any[],posts:Partial<Record<Category,Post>>):Promise<number> {
  const currentAnchors=new Set(Object.values(posts).filter(Boolean).map(p=>p!.anchor));
  const legacyTitles=[
    "**👗 FASHION REPORT • AKTUALNE**",
    "**🟢 DALAMUD • STABLE**",
    "**⚔️ FINAL FANTASY XIV • AKTUALNOŚCI**"
  ];
  const candidates=visible.filter(m=>{
    const content=String(m?.content??"");
    return m?.author?.bot===true && !currentAnchors.has(String(m.id)) &&
      legacyTitles.some(prefix=>content.startsWith(prefix)) &&
      content.includes("Nowe wiadomości pojawią się w tym poście.") &&
      content.includes("Historia jest zapisywana w wątku.") &&
      !/https?:\/\//i.test(content) && content.length<600 &&
      !(m.attachments||[]).length && !(m.embeds||[]).length;
  });
  if(!candidates.length)return 0;
  const self=await api(env,"users/@me");
  let removed=0;
  for(const m of candidates.slice(0,6)) {
    if(m.author?.id!==self.id || !ID.test(String(m.id)))continue;
    // Thread IDs equal their starter message snowflake when created from a
    // regular message. If any replies exist, leave the entire old post intact.
    let thread:any=null;
    try {
      thread=await api(env,"channels/"+m.id);
    }catch(e:any){
      if(!String(e?.message??"").includes("HTTP 404"))continue;
    }
    if(thread && [11,12].includes(Number(thread.type))) {
      try {
        const history:any=await api(env,"channels/"+m.id+"/messages?limit=100");
        // Even bot-only real history must never be discarded.
        if(!Array.isArray(history) ||
           history.some((x:any)=>x.type!==21 && x.id!==m.id))continue;
      }catch{continue;}
    }
    try {
      await api(env,"channels/"+cfg.channelId+"/messages/"+m.id,"DELETE");
      removed++;
    }catch{/* Unavailable deletion permission: leave it alone. */}
  }
  return removed;
}

export async function updateFourPosts(env:Env,cfg:BoardConfig,src:Sources,opts?:{preview?:boolean}):
Promise<{updated:number;changes:string[];errors:string[]}>{
  if(!ID.test(cfg.channelId)||!ID.test(cfg.guildId))throw new Error("Discord news channel not configured");
  const at=Date.now();
  const events=src.events;
  const activeEvent=events===null?undefined:eventCurrent(events,at);
  const expected:Record<Category,Current|null|undefined>={
    event:cfg.events?activeEvent:null,
    fashion:undefined,
    patch:cfg.lodestone?toCurrent("patch",src.patch,at):undefined,
    dalamud:cfg.dalamud?toCurrent("dalamud",src.dalamud,at):undefined
  };
  // Read the large message list only for first-time setup and one-time
  // migration. Once four posts exist and migration is done, do not poll it.
  const cleanupKey="ffxiv_board_v3_cleanup_done_"+cfg.guildId+"_"+cfg.channelId;
  const cleanupPending=await getMeta(env,cleanupKey)!=="1";
  const cached=await Promise.all(ORDER.map(cat=>loadPost(env,cfg,cat)));
  const needsDiscovery=cached.some(post=>post===null) || cleanupPending;
  const currentList:any=needsDiscovery
    ? await api(env,"channels/"+cfg.channelId+"/messages?limit=100"):[];
  if(!Array.isArray(currentList))throw new Error("Discord channel cannot be read");
  const posts:Partial<Record<Category,Post>>={};
  const errors:string[]=[];
  // Send top-to-bottom in this exact sequence only on the initial migration.
  for(const cat of ORDER){
    try{posts[cat]=await ensurePost(env,cfg,cat,currentList);}
    catch(e:any){errors.push(cat+" setup: "+String(e?.message||e));}
  }
  if(cfg.fashion){
    const post=posts.fashion;
    const live=src.fashion;
    if(post){
      const existing=post.current;
      if(live){
        if(existing?.id===live.id){
          expected.fashion=existing?.expires && existing.expires<=at?null:{
            ...existing,
            // Refresh Discord's short-lived signed CDN URL without marking
            // a new Fashion week or creating an archived duplicate.
            image:live.image||existing.image,
            imageProxy:live.imageProxy||existing.imageProxy
          };
        }else if(post.retiredId===live.id){
          // The source may serve last week's PNG for days after reset.
          expected.fashion=null;
        }else{
          expected.fashion=toCurrent("fashion",live,at);
        }
      }else if(existing?.expires && existing.expires<=at){
        expected.fashion=null;
      }
    }
  }
  if(posts.event?.current?.end && posts.event.current.end<=at && events===null) expected.event=null;
  const changes:string[]=[];
  for(const cat of ORDER){
    const post=posts[cat];
    if(!post)continue;
    // On a renderer upgrade, rehydrate each existing message from D1 even
    // when no newly forwarded source message is available. In particular
    // Fashion previously remained a header forever when its source cursor
    // had already consumed Week 460.
    const fresh=expected[cat]===undefined && post.renderRevision!==RENDER_REVISION
      ? post.current : expected[cat];
    if(fresh===undefined)continue; // Failed source: preserve current news.
    try{
      const edited=await rollover(env,cfg,cat,post,fresh,errors);
      if(edited)changes.push(cat);
    }catch(e:any){errors.push(cat+" update: "+String(e?.message||e));}
  }
  // Only migrate legacy bot-owned category anchors after all four canonical
  // messages exist, leaving anything unrecognized untouched.
  for(const cat of ["fashion","patch","dalamud"] as const)
    if(posts[cat])await oldAnchors(env,cfg,cat,posts[cat]!);
  // Only remove true, empty placeholders from the older layout once all
  // four permanent card messages exist. Preserve any posts with history.
  if(cleanupPending && ORDER.every(cat=>Boolean(posts[cat]))) {
    try {
      await cleanupLegacyPlaceholders(env,cfg,currentList,posts);
      // No more destructive legacy cleanup on subsequent daily checks.
      await putMeta(env,cleanupKey,"1");
    } catch(e:any){errors.push("legacy placeholder cleanup: "+String(e?.message||e));}
  }
  return {updated:changes.length,changes,errors};
}

// Ensure only YURA's own Discord user can embed links in this already-private
// news channel. Do not change @everyone, other roles, channel visibility or
// other permission bits. This fixes Discord silently stripping bot embeds.
export async function ensureFfxivEmbedLinks(env:Env,cfg:BoardConfig):Promise<string>{
  const [identity,channel]=await Promise.all([
    api(env,"users/@me"),api(env,"channels/"+cfg.channelId)
  ]);
  const id=String(identity?.id??"");
  if(!ID.test(id)||String(channel?.guild_id)!==cfg.guildId||
     ![0,5].includes(Number(channel?.type))||
     !Array.isArray(channel?.permission_overwrites))
    throw new Error("Cannot validate YURA-only Embed Links channel override");
  const old=channel.permission_overwrites.find((p:any)=>
    String(p.id)===id && Number(p.type)===1);
  const EMBED_LINKS=1n<<14n;
  const oldAllow=BigInt(String(old?.allow??"0")),oldDeny=BigInt(String(old?.deny??"0"));
  const allow=oldAllow|EMBED_LINKS,deny=oldDeny&~EMBED_LINKS;
  if(old && allow===oldAllow && deny===oldDeny)return "already-allowed";
  await api(env,"channels/"+cfg.channelId+"/permissions/"+id,"PUT",{
    type:1,allow:allow.toString(),deny:deny.toString()
  });
  return "enabled-for-yura-only";
}

// Layout-only migration, never posts a new announcement or archives history.
export async function refreshFfxivEventCompact(env:Env,cfg:BoardConfig):
Promise<{checked:number;updated:number;verified:number;errors:string[]}>{
  let checked=0,updated=0,verified=0;
  const errors:string[]=[];
  if(!ID.test(cfg.channelId)||!ID.test(cfg.guildId))
    return {checked,updated,verified,errors:["Invalid FFXIV Discord channel configuration"]};
  try{
    const post=await loadPost(env,cfg,"event");
    if(!post)return {checked,updated,verified,errors:["Event anchor not initialized"]};
    checked=1;
    if(await rollover(env,cfg,"event",post,post.current,errors))updated=1;
    const message=await api(env,"channels/"+cfg.channelId+"/messages/"+post.anchor);
    const desired=embedsFor("event",post.current) as any[];
    const actual=Array.isArray(message?.embeds)?message.embeds:[];
    const bodyOK=String(message?.content??"")===textFor("event",post.current);
    const embedsOK=desired.length===0?actual.length===0:actual.length===1&&
      actual[0]?.title===desired[0].title &&
      actual[0]?.url===desired[0].url &&
      actual[0]?.description===desired[0].description &&
      Number(actual[0]?.color)===desired[0].color &&
      (!desired[0]?.image || !!actual[0]?.image);
    if(bodyOK&&embedsOK)verified=1;
    else errors.push("Discord did not confirm the compact event layout"+
      " (bodyOK="+bodyOK+", embedOK="+embedsOK+", embeds="+actual.length+")");
  }catch(e:any){errors.push(String(e?.message??e).slice(0,220));}
  return {checked,updated,verified,errors};
}

// One-time styling migration reads D1 anchors and PATCHes those SAME Discord
// messages, preserving history threads and the existing native Fashion PNG.
// No news feed calls, no newly posted messages and no archive rollover.
export async function refreshFfxivCardPalette(env:Env,cfg:BoardConfig):
Promise<{checked:number;updated:number;verified:number;errors:string[]}>{
  let checked=0,updated=0,verified=0,permissionChecked=false,permissionError="";
  const errors:string[]=[];
  if(!ID.test(cfg.channelId)||!ID.test(cfg.guildId))
    return {checked,updated,verified,errors:["Invalid FFXIV Discord channel configuration"]};
  for(const category of ORDER){
    try{
      const stored=await loadPost(env,cfg,category);
      if(!stored){errors.push(category+": missing original message");continue;}
      checked++;
      // Identical old/new current.id: rollover edits only the existing card.
      if(await rollover(env,cfg,category,stored,stored.current,errors))updated++;
      let message=await api(env,"channels/"+cfg.channelId+"/messages/"+stored.anchor);
      const expected=embedsFor(category,stored.current) as any[];
      // Embeds can be silently stripped if the bot lacks Embed Links, even
      // when PATCH itself returns HTTP 200. Repair a narrowly scoped user
      // override once, then PATCH each anchored post again in-place.
      if(expected.length>0 && Array.isArray(message?.embeds) && message.embeds.length===0){
        if(!permissionChecked){
          permissionChecked=true;
          try {
            const changed=await ensureFfxivEmbedLinks(env,cfg);
            await putMeta(env,"ffxiv_card_palette_embed_permission_v11",changed);
          }catch(e:any){
            permissionError="embed-permission: "+String(e?.message||e).slice(0,140);
          }
        }
        if(await deliverCard(env,"channels/"+cfg.channelId+"/messages/"+stored.anchor,
          "PATCH",category,stored.current,errors,message))updated++;
        message=await api(env,"channels/"+cfg.channelId+"/messages/"+stored.anchor);
      }
      const actual=Array.isArray(message?.embeds)?message.embeds:[];
      const correctContent=message?.content===textFor(category,stored.current);
      const correctEmbed=expected.length===0 ? actual.length===0 :
        actual.some((e:any)=>e?.title===expected[0].title &&
          Number(e?.color)===Number(expected[0].color) &&
          (!expected[0].image || !!e?.image));
      const correctAttachment=category!=="fashion" || !stored.current?.image ||
        (Array.isArray(message?.attachments) &&
          message.attachments.some((a:any)=>/^fashion-report\.(png|jpe?g|webp)$/i.test(String(a.filename||""))));
      if(!correctContent||!correctEmbed||!correctAttachment){
        const seen=actual.slice(0,3).map((e:any)=>({
          kind:String(e?.type??"unknown"),color:Number(e?.color??0),
          titleMatch:e?.title===expected[0]?.title,hasImage:!!e?.image
        }));
        errors.push(category+": colour verification failed "+JSON.stringify({
          contentOK:correctContent,embedOK:correctEmbed,imageOK:correctAttachment,
          embedCount:actual.length,seen,expectedColor:expected[0]?.color??null,
          messageFlags:message?.flags??null
        }).slice(0,350));
      }else verified++;
    }catch(e:any){errors.push(category+": "+String(e?.message||e).slice(0,160));}
  }
  // If a moderator grants Embed Links to YURA's server role, a bot-only
  // override may still fail with 403. Live embed verification is authoritative.
  if(permissionError && verified!==4)errors.unshift(permissionError);
  return {checked,updated,verified,errors};
}

// A Discord REST read is the source of truth: a successful Cloud run or
// a green message does not prove that the image was actually uploaded.
export async function verifyFashionReportImage(env:Env,cfg:BoardConfig):
Promise<{attached:boolean;reason:string;messageId?:string}>{
  const state=await loadPost(env,cfg,"fashion");
  if(!state?.current?.image)return {attached:false,reason:"Brak bieżącego Fashion Reportu w Cloud"};
  const message=await api(env,"channels/"+cfg.channelId+"/messages/"+state.anchor);
  const attachment=(Array.isArray(message?.attachments)?message.attachments:[])
    .find((a:any)=>/^fashion-report\.(?:png|jpg|webp)$/i.test(String(a.filename||"")));
  if(attachment?.id)return {
    attached:true,reason:"Plik "+String(attachment.filename)+" zapisany w Discordzie",
    messageId:state.anchor
  };
  return {attached:false,messageId:state.anchor,
    reason:"Wiadomość Fashion Report nie ma załączonej grafiki • sprawdź Attach Files dla YURY"};
}

// Called only at the top of each UTC hour (two compact D1 reads). It does
// NOT poll public news feeds or post a status update. A scheduled event or
// the Fashion Report can expire promptly even when the next news check is
// tomorrow morning.
export async function expireFourPosts(env:Env,cfg:BoardConfig,at=Date.now()):
Promise<{expired:Category[];errors:string[]}> {
  const expired:Category[]=[];
  const errors:string[]=[];
  if(!ID.test(cfg.channelId)||!ID.test(cfg.guildId))return {expired,errors};
  for(const cat of ["event","fashion"] as const){
    try{
      const post=await loadPost(env,cfg,cat);
      if(!post?.current)continue;
      const deadline=cat==="event"?post.current.end:post.current.expires;
      if(!deadline || deadline>at)continue;
      await rollover(env,cfg,cat,post,null,errors);
      expired.push(cat);
    }catch(e:any){errors.push(cat+": "+String(e?.message||e));}
  }
  return {expired,errors};
}
