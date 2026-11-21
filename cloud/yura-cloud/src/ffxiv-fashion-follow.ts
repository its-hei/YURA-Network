import {discordFfxivRequest} from "./ffxiv-discord-api.ts";
// Discord Follow mirrors an announcement channel into the user's private
// #mods・spam channel. Read-only: we do not write to the source channel.
// The first scan imports the user's already-posted infographic as the current
// report. Subsequent scans accept ONLY newly mirrored Fashion Reporter webhooks.
export type FollowedFashion = {
  source: "fashion"; id: string; title:string; url:string;
  date:number; image:string;
};
export interface FashionSourceEnv {DB:D1Database; DISCORD_BOT_TOKEN?:string}
const validID=(v:string)=>/^[0-9]{15,22}$/.test(v);
const discordEpoch=1420070400000n;
const safeSnowflake=(id:string):bigint=>validID(id)?BigInt(id):0n;
const normalized=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g,"");
const sourceKey=(guild:string,channel:string)=>"ffxiv_fashion_follow_cursor_v1_"+guild+"_"+channel;
const currentKey=(guild:string,channel:string)=>"ffxiv_fashion_current_source_v4_"+guild+"_"+channel;
const importKey=(guild:string,channel:string)=>"ffxiv_fashion_first_manual_import_v2_"+guild+"_"+channel;
const imageHosts=new Set(["cdn.discordapp.com","media.discordapp.net","images-ext-1.discordapp.net","images-ext-2.discordapp.net"]);
const discord=discordFfxivRequest;
async function meta(env:FashionSourceEnv,key:string):Promise<string>{
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value??"");
}
async function putMeta(env:FashionSourceEnv,key:string,value:string){
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key,value).run();
}
export async function locateFollowedFashionChannel(
  env:FashionSourceEnv,guildId:string,configuredChannelId=""
):Promise<string|null>{
  if(!validID(guildId))throw new Error("FFXIV Discord guild not configured");
  if(configuredChannelId){
    if(!validID(configuredChannelId))throw new Error("Invalid Fashion source channel ID");
    const ch=await discord(env,"channels/"+configuredChannelId);
    if(String(ch?.guild_id)!==guildId || Number(ch?.type)!==0)
      throw new Error("Wybrany kanał Fashion Source nie należy do tego serwera lub nie jest kanałem tekstowym");
    return configuredChannelId;
  }
  const chans:any=await discord(env,"guilds/"+guildId+"/channels");
  if(!Array.isArray(chans))throw new Error("Discord channel list unavailable");
  const matched=chans.filter((c:any)=>Number(c.type)===0 &&
    normalized(String(c.name||""))==="modsspam" && validID(String(c.id||"")));
  if(matched.length>1)throw new Error("Multiple #mods-spam channels; cannot choose Fashion source automatically");
  return matched.length?String(matched[0].id):null;
}
function safeImage(value:unknown):string{
  try{
    const u=new URL(String(value||""));
    if(u.protocol!=="https:"||!imageHosts.has(u.hostname))return "";
    if(!/\.(?:png|jpe?g|webp)$/i.test(u.pathname))return "";
    return u.toString();
  }catch{return "";}
}
function messageContents(message:any):any[] {
  // Discord's native manual Forward action puts the original image and
  // title in message_snapshots[0].message (not the new message's embeds).
  const snapshots=Array.isArray(message?.message_snapshots)?message.message_snapshots:[];
  return [message,...snapshots.map((s:any)=>s?.message).filter(Boolean)];
}
function fashionImage(message:any):string {
  const contents=messageContents(message);
  const embeds=contents.flatMap((m:any)=>Array.isArray(m.embeds)?m.embeds:[]);
  const attachments=contents.flatMap((m:any)=>Array.isArray(m.attachments)?m.attachments:[]);
  const images=[
    ...attachments.flatMap((a:any)=>[a.url,a.proxy_url]),
    ...embeds.flatMap((e:any)=>[e.image?.url,e.image?.proxy_url])
  ];
  for(const i of images) {
    const img=safeImage(i);
    if(img)return img;
  }
  return "";
}
function weekNumber(message:any):number|null {
  const contents=messageContents(message);
  const embeds=contents.flatMap((m:any)=>Array.isArray(m.embeds)?m.embeds:[]);
  const attachments=contents.flatMap((m:any)=>Array.isArray(m.attachments)?m.attachments:[]);
  const txt=[...contents.map((m:any)=>m.content),...embeds.map((e:any)=>e.title),
    ...embeds.map((e:any)=>e.description),
    ...attachments.map((a:any)=>a.filename)]
    .filter(x=>typeof x==="string").join("\n");
  const match=txt.match(/fashion\s*report(?:er)?\s*(?:week\s*)?#?\s*(\d{3,4})/i)
    || txt.match(/\bweek\s*#?\s*(\d{3,4})\b/i);
  const number=Number(match?.[1]);
  return Number.isInteger(number)&&number>=100&&number<=9999?number:null;
}
function makeFashion(message:any,guildId:string,channelId:string,allowUntitled=false):FollowedFashion|null{
  const id=String(message?.id??"");
  if(!validID(id))return null;
  const image=fashionImage(message);
  if(!image)return null;
  const week=weekNumber(message);
  if(!week&&!allowUntitled)return null;
  const date=Date.parse(String(message.timestamp||""));
  if(!Number.isFinite(date)||date>Date.now()+3600000)return null;
  // Keep the image's original Discord provenance in the main card link.
  return {
    source:"fashion",id:week?"discord-fashion-week-"+week:"discord-fashion-manual-"+id,
    title:week?"Fashion Report • Week "+week:"Fashion Report • aktualny raport",
    url:"https://discord.com/channels/"+guildId+"/"+channelId+"/"+id,
    date,image
  };
}
/** After the initial import, only a real followed-channel webhook is trusted. */
export function parseFollowedFashion(message:any,guildId:string,channelId:string):FollowedFashion|null{
  if(!validID(String(message?.webhook_id??"")))return null;
  const fromAnotherChannel=validID(String(message.message_reference?.channel_id||"")) &&
    String(message.message_reference.channel_id)!==channelId;
  const namedReporter=/fashion\s*reporter/i.test(String(message.author?.username||""));
  if(!fromAnotherChannel&&!namedReporter)return null;
  return makeFashion(message,guildId,channelId);
}
/** The ONE existing, manually posted infographic may be imported at startup. */
export function parseInitialManualFashion(message:any,guildId:string,channelId:string):FollowedFashion|null{
  // Don't mistake YURA's status posts or Discord system notices for a report.
  if(message?.author?.bot===true && !message.webhook_id)return null;
  if(message?.webhook_id)return parseFollowedFashion(message,guildId,channelId);
  const contents=messageContents(message);
  const attachments=contents.flatMap((m:any)=>Array.isArray(m.attachments)?m.attachments:[]);
  const embeds=contents.flatMap((m:any)=>Array.isArray(m.embeds)?m.embeds:[]);
  const week=weekNumber(message);
  // An untitled image is allowed only during FIRST bootstrap, only if it
  // looks like a full infographic rather than an unrelated emoji/thumbnail.
  // A user-pasted screenshot of this publisher's 16:9 gear infographic
  // can be around 550 px wide after Discord's image processing.
  const imageSizeOK=(img:any)=>Number(img?.width)>=450 &&
    Number(img?.height)>=240 &&
    Number(img?.width)/Math.max(1,Number(img?.height))>=1.25;
  const largeImage=attachments.some(imageSizeOK)
    || embeds.some((e:any)=>imageSizeOK(e.image));
  if(!week&&!largeImage)return null;
  const candidate=makeFashion(message,guildId,channelId,largeImage);
  if(!candidate)return null;
  // Imported report must be from the current Fashion Report week. Old manual
  // uploads are never reactivated after more than seven days.
  return Date.now()-candidate.date<=7*86400000?candidate:null;
}
export type FashionPoll={
  sourceChannelId:string;
  sourceStatus:"initialized"|"new"|"unchanged"|"manual-current";
  candidate?:FollowedFashion;cursor?:string;firstImport?:boolean;
  inspected:number; validImages:number;
};
function storedCurrent(value:string,guildId:string,channelId:string):FollowedFashion|null {
  try {
    const x=JSON.parse(value);
    if(x?.source!=="fashion" || typeof x.id!=="string" ||
       !/^discord-fashion-(?:week-\d{3,4}|manual-\d{15,22})$/.test(x.id) ||
       typeof x.title!=="string" || !Number.isFinite(x.date) ||
       typeof x.url!=="string" ||
       !x.url.startsWith("https://discord.com/channels/"+guildId+"/"+channelId+"/") ||
       !safeImage(x.image))return null;
    return x as FollowedFashion;
  }catch{return null;}
}
function weekOf(x:FollowedFashion):number|null {
  const m=x.id.match(/^discord-fashion-week-(\d{3,4})$/);
  return m?Number(m[1]):null;
}
export async function pollFollowedFashion(env:FashionSourceEnv,guildId:string,
  configuredChannelId="",forceInitialImport=false):Promise<FashionPoll|null>{
  const id=await locateFollowedFashionChannel(env,guildId,configuredChannelId);
  if(!id)return null;
  const key=sourceKey(guildId,id);
  const raw=await discord(env,"channels/"+id+"/messages?limit=100");
  if(!Array.isArray(raw))throw new Error("Fashion Reporter source messages unavailable");
  const ordered=raw.filter((m:any)=>validID(String(m.id||"")))
    .sort((a:any,b:any)=>safeSnowflake(String(a.id))<safeSnowflake(String(b.id))?-1:1);
  const last=await meta(env,key);
  const initialCandidates=ordered.map((m:any)=>parseInitialManualFashion(m,guildId,id))
    .filter((x:FollowedFashion|null):x is FollowedFashion=>x!==null);
  const manualImageCount=initialCandidates.length;
  const stored=storedCurrent(await meta(env,currentKey(guildId,id)),guildId,id);
  // Read an up-to-date signed CDN URL from the original Discord message
  // when available, but never switch to a *different* manual message once
  // the initial report has been acknowledged.
  const current=stored
    ? initialCandidates.find(x=>x.id===stored.id)||stored : null;
  const newer=last?ordered.filter((m:any)=>safeSnowflake(String(m.id))>safeSnowflake(last)):[];
  const webhookReports=newer.map((m:any)=>parseFollowedFashion(m,guildId,id))
    .filter((x:FollowedFashion|null):x is FollowedFashion=>x!==null);
  const latestWebhook=webhookReports[webhookReports.length-1];
  const newest=ordered.length?String(ordered[ordered.length-1].id):
    ((BigInt(Date.now())-discordEpoch)<<22n).toString();
  const cursor=last && safeSnowflake(newest)<safeSnowflake(last)?last:newest;
  let selected:FollowedFashion|null=null;
  let firstImport=false;
  let status:FashionPoll["sourceStatus"]="unchanged";
  if(latestWebhook){
    const nextWeek=weekOf(latestWebhook),previousWeek=current&&weekOf(current);
    // Do not replace a newer report with an old week re-forwarded later.
    if(previousWeek===null || nextWeek===null || nextWeek>=previousWeek) {
      selected=latestWebhook;
      status="new";
    }
  }
  if(!selected && current){
    // Reconcile the active Discord card even when the source cursor
    // has advanced. Without replay, the board sees undefined and skips
    // a previously created-but-empty Fashion post forever.
    selected=current;
    status="unchanged";
  }
  if(!selected && !stored){
    // One-time recovery: old releases marked the import as complete even
    // when the image never reached the main Discord post. If no current
    // source was persisted, recover the manual post still visible this week.
    // Once acknowledged, all later manual chat posts remain ignored.
    selected=initialCandidates[initialCandidates.length-1]||null;
    firstImport=!!selected;
    status=selected?"manual-current":"initialized";
  }
  return {sourceChannelId:id,sourceStatus:status,
    ...(selected?{candidate:selected}:{}),cursor,
    firstImport:firstImport||(!last&&!!selected),
    inspected:ordered.length,validImages:manualImageCount};
}
export async function acknowledgeFashionPoll(env:FashionSourceEnv,guildId:string,poll:FashionPoll){
  if(poll.cursor && validID(poll.cursor))
    await putMeta(env,sourceKey(guildId,poll.sourceChannelId),poll.cursor);
  // Persist the actual last accepted report, not only the cursor. Cursor
  // progress by itself cannot recover a Fashion card left without content.
  if(poll.candidate)
    await putMeta(env,currentKey(guildId,poll.sourceChannelId),JSON.stringify(poll.candidate));
  if(poll.firstImport && poll.candidate) {
    await putMeta(env,importKey(guildId,poll.sourceChannelId),"1");
    await putMeta(env,"ffxiv_fashion_manual_repair_v3_"+guildId+"_"+poll.sourceChannelId,"1");
  }
}
