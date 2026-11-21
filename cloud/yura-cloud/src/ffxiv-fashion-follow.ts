// Discord Follow mirrors an announcement channel into the user's private
// #mods・spam channel. Read-only: we do not write to the source channel.
// The first scan establishes a high-water mark (existing manually added
// report is the baseline); only subsequently forwarded webhooks are used.
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
const imageHosts=new Set(["cdn.discordapp.com","media.discordapp.net","images-ext-1.discordapp.net","images-ext-2.discordapp.net"]);
async function discord(env:FashionSourceEnv,path:string):Promise<any>{
  const bot=env.DISCORD_BOT_TOKEN?.trim();
  if(!bot)throw new Error("Discord bot token missing");
  const r=await fetch("https://discord.com/api/v10/"+path,{
    headers:{authorization:"Bot "+bot,"user-agent":"YURA-Cloud/Fashion-Follow"}
  });
  if(!r.ok)throw new Error("Discord Fashion source HTTP "+r.status);
  return r.json();
}
async function meta(env:FashionSourceEnv,key:string):Promise<string>{
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value??"");
}
async function putMeta(env:FashionSourceEnv,key:string,value:string){
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key,value).run();
}
export async function locateFollowedFashionChannel(
  env:FashionSourceEnv,guildId:string
):Promise<string|null>{
  if(!validID(guildId))throw new Error("FFXIV Discord guild not configured");
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
/** Only a genuine followed-channel webhook with a titled weekly infographic. */
export function parseFollowedFashion(message:any,guildId:string,channelId:string):FollowedFashion|null{
  if(!validID(String(message?.id||"")) || !validID(String(message?.webhook_id||"")))return null;
  const embeds=Array.isArray(message.embeds)?message.embeds:[];
  const attachments=Array.isArray(message.attachments)?message.attachments:[];
  const titleParts=[message.content,...embeds.map((e:any)=>e.title),...embeds.map((e:any)=>e.description)]
    .filter(x=>typeof x==="string").map(String);
  const caption=titleParts.join("\n").slice(0,3000);
  const found=caption.match(/\bfashion\s*report\s*(?:week\s*)?#?\s*(\d{3,4})\b/i);
  if(!found)return null;
  // Discord Follow can change the webhook display name; the original
  // forwarded message has a channel reference, while a custom webhook may
  // use the expected "Fashion Reporter" name. Do not accept regular chat.
  const isCrosspost=validID(String(message.message_reference?.channel_id||"")) &&
    String(message.message_reference.channel_id)!==channelId;
  const knownWebhook=/fashion\s*reporter/i.test(String(message.author?.username||""));
  if(!isCrosspost&&!knownWebhook)return null;
  let image="";
  const imgs=[
    ...attachments.flatMap((a:any)=>[a.url,a.proxy_url]),
    ...embeds.flatMap((e:any)=>[e.image?.url,e.image?.proxy_url]),
    ...embeds.flatMap((e:any)=>[e.thumbnail?.url,e.thumbnail?.proxy_url])
  ];
  for(const src of imgs){image=safeImage(src);if(image)break;}
  if(!image)return null;
  const date=Date.parse(String(message.timestamp||""));
  if(!Number.isFinite(date))return null;
  const week=Number(found[1]);
  if(week<100||week>9999)return null;
  return {
    source:"fashion",id:"discord-fashion-week-"+week,
    title:"Fashion Report • Week "+week+" • rozwiązanie na 80/100 punktów",
    url:"https://discord.com/channels/"+guildId+"/"+channelId+"/"+message.id,
    date,image
  };
}
export type FashionPoll={
  sourceChannelId:string; sourceStatus:"initialized"|"new"|"unchanged";
  candidate?:FollowedFashion;cursor?:string;
};
export async function pollFollowedFashion(env:FashionSourceEnv,guildId:string):Promise<FashionPoll|null>{
  const id=await locateFollowedFashionChannel(env,guildId);
  if(!id)return null;
  const key=sourceKey(guildId,id);
  const raw=await discord(env,"channels/"+id+"/messages?limit=100");
  if(!Array.isArray(raw))throw new Error("Fashion Reporter source messages unavailable");
  const ordered=raw.filter((m:any)=>validID(String(m.id||"")))
    .sort((a:any,b:any)=>safeSnowflake(String(a.id))<safeSnowflake(String(b.id))?-1:1);
  const last=await meta(env,key);
  if(!last){
    // First manually added report (and any already present posts) are
    // historical. Record the latest Discord message without reposting it.
    const newest=ordered.length?String(ordered[ordered.length-1].id):
      ((BigInt(Date.now())-discordEpoch)<<22n).toString();
    await putMeta(env,key,newest);
    return {sourceChannelId:id,sourceStatus:"initialized"};
  }
  const newer=ordered.filter((m:any)=>safeSnowflake(String(m.id))>safeSnowflake(last));
  const newest=newer.length?String(newer[newer.length-1].id):last;
  const candidates=newer.map((m:any)=>parseFollowedFashion(m,guildId,id))
    .filter((x:FollowedFashion|null):x is FollowedFashion=>x!==null);
  const selected=candidates[candidates.length-1];
  return {sourceChannelId:id,sourceStatus:selected?"new":"unchanged",
    ...(selected?{candidate:selected}:{}),cursor:newest};
}
export async function acknowledgeFashionPoll(env:FashionSourceEnv,guildId:string,poll:FashionPoll){
  if(poll.cursor && validID(poll.cursor))
    await putMeta(env,sourceKey(guildId,poll.sourceChannelId),poll.cursor);
}
