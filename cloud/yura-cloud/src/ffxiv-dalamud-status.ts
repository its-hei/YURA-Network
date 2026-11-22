// Read ONLY announcements mirrored by Discord's Channel Following webhooks
// into the user's existing #statusy channel. No access to another guild,
// user token, or Discord Gateway is necessary.
//
// A stable version number is never evidence that all plugins work.
// We use explicit status statements, keep the original excerpt, and never
// invent a recovery time.
import {discordFfxivRequest} from "./ffxiv-discord-api.ts";

type Env={DISCORD_BOT_TOKEN?:string};
export type DalamudOfficialStatus={
  messageId:string;
  channelId:string;
  guildId:string;
  headline:string;
  excerpt:string;
  author:string;
  sourceUrl:string;
  at:number;
  state:"available"|"unavailable"|"working"|"unknown";
  eta:string;
  reason?:string;
  sourceKind?:"discord-follow"|"user-screenshot";
  support?:string;
};
const SNOW=/^\d{15,22}$/;
function tidy(value:unknown,max=620):string {
  return String(value??"")
    .replace(/<@!?\d+>|<@&\d+>|<#[0-9]+>/g,"[Discord]")
    .replace(/@(?=everyone|here)/gi,"＠")
    .replace(/[\u0000-\u001f\u007f]/g," ")
    .replace(/\s+/g," ").trim().slice(0,max);
}
export function classifyDalamudAnnouncement(text:string):DalamudOfficialStatus["state"]{
  const content=text.toLowerCase();
  const online=/\bplugins? (?:are |is )?(?:back|working|online|available|restored|enabled)\b|\bdalamud (?:is |has been )?(?:back|working|available|restored|live)\b|\bplugin support (?:is |has been )?(?:restored|enabled)\b/i.test(content);
  const offline=/\b(?:dalamud|plugins?) (?:are |is )?(?:currently |still )?(?:disabled|unavailable|offline|down|broken|not working)\b|\b(?:dalamud|plugins?) (?:will not|won't|cannot|can't) (?:work|load|start)\b|\b(?:not available|still disabled|currently disabled|not yet supported|plugins? (?:will not|won't) work)\b/i.test(content);
  const ongoing=/\b(?:working on|investigating|still testing|still being tested|awaiting|waiting for|in progress|under maintenance|being updated|updating dalamud)\b/i.test(content);
  if(online&&offline)return "unknown";
  if(offline)return "unavailable";
  if(online)return "available";
  if(ongoing)return "working";
  return "unknown";
}
export function parseFollowedDalamudMessages(messages:unknown,guildId:string,
  channelId:string,at=Date.now()):
  {status:DalamudOfficialStatus|null;inspected:number;followed:number;qualified:number}{
  if(!Array.isArray(messages))throw Error("Discord messages response invalid");
  let inspected=0,followed=0,qualified=0;
  const candidates:DalamudOfficialStatus[]=[];
  for(const m of messages){
    inspected++;
    if(!m||typeof m!=="object"||!SNOW.test(String(m.id??""))||
      !SNOW.test(String(m.webhook_id??"")))continue;
    followed++;
    const author=tidy(m.author?.username||m.author?.global_name||"",60);
    const embeds=Array.isArray(m.embeds)?m.embeds.slice(0,4):[];
    const raw=[m.content,...embeds.flatMap((e:any)=>[e?.title,e?.description])]
      .filter(Boolean).join("\n");
    const full=tidy(raw,2400);
    // A forwarded message must identify the official Dalamud/XIVLauncher
    // project or KazWolfe and actually contain a relevant statement.
    const identifiable=/kazwolfe|xivlauncher|dalamud|goatcorp/i.test(
      [author,m.author?.global_name,m.author?.username].join(" "));
    const onTopic=/\bdalamud\b|\bplugins?\b|\bxivlauncher\b|\bpatch\s*\d+\.\d+/i.test(full);
    const status=classifyDalamudAnnouncement(full);
    if(!identifiable||!onTopic||status==="unknown")continue;
    // A Channel Following webhook is located in our guild, but its source
    // message may belong to another guild. We only read the local mirror.
    const reference=m.message_reference;
    const stamp=Date.parse(String(m.timestamp??""));
    if(!Number.isFinite(stamp)||stamp>at+60000)continue;
    qualified++;
    const sourceGuild=String(reference?.guild_id??guildId);
    const sourceChannel=String(reference?.channel_id??channelId);
    const sourceMessage=String(reference?.message_id??m.id);
    const original=SNOW.test(String(reference?.guild_id??"")) &&
      SNOW.test(String(reference?.channel_id??"")) &&
      SNOW.test(String(reference?.message_id??"")) &&
      SNOW.test(sourceGuild)&&SNOW.test(sourceChannel)&&SNOW.test(sourceMessage);
    const link=original
      ? "https://discord.com/channels/"+sourceGuild+"/"+sourceChannel+"/"+sourceMessage
      : "https://discord.com/channels/"+guildId+"/"+channelId+"/"+m.id;
    const headline=tidy(embeds[0]?.title||full.split(/\n/)[0]||"Komunikat Dalamud",110);
    const etaMatch=/\b(?:no|unknown|not announced|no confirmed)\s+(?:ETA|estimated (?:time|date))\b/i.test(full)
      ?null:full.match(/\b(?:ETA|estimated (?:time|release)|expected (?:by|around|at))\s*[:\-]?\s*([^.!?]{3,110})/i);
    const reasonMatch=full.match(/\b(?:because|due to|caused by|waiting for)\s+([^.!?]{8,180})/i);
    candidates.push({
      messageId:String(m.id),channelId,guildId,headline,
      excerpt:tidy(full,510),author:author||"XIVLauncher & Dalamud",
      sourceUrl:link,at:stamp,state:status,
      eta:etaMatch?tidy(etaMatch[1],100):"",
      reason:reasonMatch?tidy(reasonMatch[1],180):""
    });
  }
  candidates.sort((a,b)=>b.at-a.at||b.messageId.localeCompare(a.messageId));
  return {status:candidates[0]||null,inspected,followed,qualified};
}
export async function pollFollowedDalamud(env:Env,guildId:string,channelId:string,at=Date.now()){
  if(!SNOW.test(guildId)||!SNOW.test(channelId))throw Error("Invalid Discord source location");
  const messages=await discordFfxivRequest(env,"channels/"+channelId+"/messages?limit=100");
  return parseFollowedDalamudMessages(messages,guildId,channelId,at);
}

// Historical, user-supplied screenshot of the official #announcements post.
// This is a one-time TEST BACKFILL, NOT a fresh Discord webhook or proof
// of the live state on 22 November. Timestamp shown: 10 Nov 2026, 23:05 CET.
// No fabricated Discord message snowflake or link to a private server.
export function testBackfillPatch758Announcement():DalamudOfficialStatus{
  return {
    messageId:"manual-screenshot-kazwolfe-758-20261110",
    channelId:"",guildId:"",
    headline:"Patch 7.58 - Dalamud Updated",
    author:"KazWolfe • #announcements (zrzut użytkownika)",
    at:Date.parse("2026-11-10T22:05:00Z"),
    state:"available",eta:"",sourceUrl:"",sourceKind:"user-screenshot",
    excerpt:"10 listopada KazWolfe potwierdził: serwery FFXIV i pluginy Dalamuda wróciły po patchu 7.58. Osobom będącym w grze zalecił dokończenie aktywności przed restartem klienta.",
    support:"Jeśli pluginy nie działają: dodaj Dalamud i XIVLauncher do wyjątków antywirusa, spróbuj naprawy gry i uruchom ją bez pluginów z niestandardowych repozytoriów."
  };
}
