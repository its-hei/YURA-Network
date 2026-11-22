// Automatic AND-gate for Boomersi / Ordo Noctis #fc-linkshell.
// Only members who actually have BOTH Discord roles XIV and FC may have
// the technical FC XIV role. The source roles are never assigned here.
import {discordFfxivRequest} from "./ffxiv-discord-api";

type Env={DB:D1Database;DISCORD_BOT_TOKEN?:string};
type Role={id:string;name:string;position:number;permissions:string;managed?:boolean};
type Member={user?:{id?:string;bot?:boolean};roles?:string[]};
type Overwrite={id:string;type:number;allow:string;deny:string};
type PermissionChange={id:string;type:number;allow:string;deny:string};
type Status={status:string;checked_at_utc:string;guild_id?:string;channel_id?:string;
  eligible?:number;members?:number;added?:number;removed?:number;
  permission_changes?:number;pending?:number;error?:string};
const STATUS_KEY="discord_fc_linkshell_last_sync_v1";
const CONFIG_KEY="discord_onboarding_config_v1";
const SNOWFLAKE=/^[0-9]{15,22}$/;
const VIEW=1n<<10n,ADMIN=1n<<3n,MANAGE_ROLES=1n<<28n;
const MAX_MEMBER_PAGES=20,MAX_ROLE_CHANGES=30;
const api=discordFfxivRequest;

const bits=(value:unknown):bigint=>BigInt(String(value??"0"));
const has=(value:unknown,flag:bigint)=> (bits(value)&flag)!==0n;
const once=(roles:Role[],name:string):Role=>{
  const found=roles.filter(role=>role.name===name);
  if(found.length!==1)throw new Error("Expected exactly one Discord role named "+name+" (found "+found.length+")");
  return found[0];
};
const validId=(id:unknown):id is string=>typeof id==="string"&&SNOWFLAKE.test(id);
async function meta(env:Env,key:string):Promise<string>{
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value??"");
}
async function saveStatus(env:Env,status:Status):Promise<void>{
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(STATUS_KEY,JSON.stringify(status)).run();
}
export async function fcLinkshellStatus(env:Env):Promise<Status|null>{
  try{return JSON.parse(await meta(env,STATUS_KEY)||"null") as Status|null;}catch{return null;}
}
async function listMembers(env:Env,guild:string):Promise<Member[]>{
  const members:Member[]=[];
  let after="";
  const seen=new Set<string>();
  for(let page=0;page<MAX_MEMBER_PAGES;page++){
    const q="?limit=1000"+(after?"&after="+after:"");
    const list=await api(env,"guilds/"+guild+"/members"+q);
    if(!Array.isArray(list))throw new Error("Discord member list is not an array");
    if(list.length>1000)throw new Error("Discord returned an oversized member page");
    for(const member of list as Member[]){
      const id=member?.user?.id;
      if(!validId(id)||!Array.isArray(member.roles)||seen.has(id))
        throw new Error("Discord member list is incomplete or malformed");
      if(after&&BigInt(id)<=BigInt(after))
        throw new Error("Discord member pages are not ordered");
      seen.add(id);
      members.push(member);
    }
    if(list.length<1000){
      if(!members.length)throw new Error("Discord member list is empty");
      return members;
    }
    const last=list[list.length-1] as Member;
    after=String(last.user?.id??"");
    if(!validId(after))throw new Error("Discord member cursor is invalid");
  }
  // Never revoke roles based on an incomplete pagination result.
  throw new Error("Discord member pagination exceeded safety cap");
}
export function planFcLinkshellPermissions(
  current:Overwrite[],roles:Role[],guild:string,target:string,botRoleIds:string[],botId:string
):PermissionChange[]{
  const roleById=new Map(roles.map(r=>[r.id,r]));
  const known=new Map<string,Overwrite>();
  for(const overwrite of current){
    if(!validId(overwrite.id)||![0,1].includes(Number(overwrite.type))||
      known.has(overwrite.id))throw new Error("Invalid or duplicate channel overwrite");
    known.set(overwrite.id,overwrite);
  }
  // Preserve admin and bot access. Other role/member VIEW_CHANNEL overrides
  // can bypass the intended AND condition, so remove only that one allow bit.
  const protectedRole=(id:string)=>{
    const r=roleById.get(id);
    return !!r&&(has(r.permissions,ADMIN)||
      (r.name==="Y.U.R.A."&&botRoleIds.includes(r.id)));
  };
  const plan:PermissionChange[]=[];
  const ids=new Set([...current.map(x=>x.id),guild,target]);
  for(const id of ids){
    const old=known.get(id);
    const type=old?Number(old.type):0;
    const a=bits(old?.allow),d=bits(old?.deny);
    let allow=a,deny=d;
    if(id===guild){
      allow&=~VIEW;deny|=VIEW;
    }else if(id===target){
      allow|=VIEW;deny&=~VIEW;
    }else if(type===0){
      if(!protectedRole(id))allow&=~VIEW;
    }else if(id!==botId){
      allow&=~VIEW;
    }
    if(allow!==a||deny!==d||!old)plan.push({
      id,type,allow:allow.toString(),deny:deny.toString()
    });
  }
  return plan;
}
export function planFcLinkshellMembers(members:Member[],xiv:string,fc:string,target:string){
  const grant:string[]=[],revoke:string[]=[];
  let eligible=0;
  for(const m of members){
    if(m.user?.bot===true)continue;
    const id=String(m.user?.id??"");
    if(!validId(id)||!Array.isArray(m.roles))
      throw new Error("Discord member roles are incomplete");
    const shouldHave=m.roles.includes(xiv)&&m.roles.includes(fc);
    if(shouldHave)eligible++;
    const hasTarget=m.roles.includes(target);
    if(shouldHave&&!hasTarget)grant.push(id);
    if(!shouldHave&&hasTarget)revoke.push(id);
  }
  return {eligible,grant,revoke};
}
export async function syncFcLinkshell(env:Env):Promise<Status>{
  const checked_at_utc=new Date().toISOString();
  let guild="";
  try{
    let saved:any={};
    try{saved=JSON.parse(await meta(env,CONFIG_KEY)||"{}");}
    catch{throw new Error("Discord onboarding configuration is malformed");}
    guild=String(saved.guild??"");
    const fcConfigured=String(saved.fc??"");
    if(!validId(guild)||!validId(fcConfigured))
      throw new Error("Discord onboarding guild / FC role not configured");
    if(!env.DISCORD_BOT_TOKEN)throw new Error("Discord bot token is missing");
    const [rawRoles,rawChannels,me]=await Promise.all([
      api(env,"guilds/"+guild+"/roles"),
      api(env,"guilds/"+guild+"/channels"),
      api(env,"users/@me")
    ]);
    if(!Array.isArray(rawRoles)||!Array.isArray(rawChannels)||!validId(me?.id))
      throw new Error("Discord guild roles, channels or bot identity unavailable");
    const roles=rawRoles as Role[];
    const xiv=once(roles,"XIV"),fc=once(roles,"FC"),target=once(roles,"FC XIV");
    if(fc.id!==fcConfigured)throw new Error("FC role differs from the onboarding configuration");
    if(new Set([guild,xiv.id,fc.id,target.id]).size!==4)
      throw new Error("FC gate needs three distinct, non-everyone roles");
    if(target.managed||has(target.permissions,ADMIN|MANAGE_ROLES)||
      has(xiv.permissions,ADMIN)||has(fc.permissions,ADMIN))
      throw new Error("One of the FC gate roles has unsafe permissions");
    const channelMatches=rawChannels.filter((c:any)=>
      c?.name==="fc-linkshell"&&Number(c.type)===0&&String(c.guild_id)===guild);
    if(channelMatches.length!==1)
      throw new Error("Expected exactly one #fc-linkshell text channel");
    const channelId=String(channelMatches[0].id);
    if(!validId(channelId))throw new Error("Invalid #fc-linkshell ID");
    const [channel,botMember,members]=await Promise.all([
      api(env,"channels/"+channelId),
      api(env,"guilds/"+guild+"/members/"+me.id),
      listMembers(env,guild)
    ]);
    if(String(channel?.guild_id)!==guild || !Array.isArray(channel.permission_overwrites) ||
      !Array.isArray(botMember?.roles))
      throw new Error("Missing channel overwrites or bot member roles");
    const botRoles=botMember.roles as string[];
    const highest=Math.max(0,...roles.filter(r=>botRoles.includes(r.id)).map(r=>Number(r.position)||0));
    if(highest<=Number(target.position))
      throw new Error("Y.U.R.A. role must be above FC XIV in server role hierarchy");
    const botPermissions=roles.filter(r=>r.id===guild||botRoles.includes(r.id))
      .reduce((total,r)=>total|bits(r.permissions),0n);
    if((botPermissions&(ADMIN|MANAGE_ROLES))===0n)
      throw new Error("Y.U.R.A. lacks Manage Roles permission");
    const plan=planFcLinkshellPermissions(
      channel.permission_overwrites as Overwrite[],roles,guild,target.id,botRoles,me.id);
    const desired=planFcLinkshellMembers(members,xiv.id,fc.id,target.id);

    // Secure channel first; preserve all other per-role permission bits.
    for(const p of plan)
      await api(env,"channels/"+channelId+"/permissions/"+p.id,"PUT",{
        allow:p.allow,deny:p.deny,type:p.type
      });
    let added=0,removed=0,processed=0;
    // Revokes first, then grants; independently verify current member roles
    // just before every write to avoid acting on a stale full-list snapshot.
    for(const [ids,assign] of [[desired.revoke,false],[desired.grant,true]] as const){
      for(const id of ids){
        if(processed>=MAX_ROLE_CHANGES)break;
        let member:Member;
        try{member=await api(env,"guilds/"+guild+"/members/"+id);}
        catch(e){
          if(String(e).includes("HTTP 404"))continue;throw e;
        }
        if(member.user?.bot===true||!Array.isArray(member.roles))
          throw new Error("Incomplete member roles during FC gate change");
        const shouldHave=member.roles.includes(xiv.id)&&member.roles.includes(fc.id);
        const hasTarget=member.roles.includes(target.id);
        if(shouldHave===hasTarget)continue;
        // The live roles always win, even if they changed after the scan.
        await api(env,"guilds/"+guild+"/members/"+id+"/roles/"+target.id,
          shouldHave?"PUT":"DELETE");
        if(shouldHave)added++;else removed++;
        processed++;
      }
    }
    const status:Status={status:desired.grant.length+desired.revoke.length>processed?"partial":"ready",
      checked_at_utc,guild_id:guild,channel_id:channelId,
      members:members.filter(m=>m.user?.bot!==true).length,eligible:desired.eligible,
      added,removed,permission_changes:plan.length,
      pending:Math.max(0,desired.grant.length+desired.revoke.length-processed)};
    await saveStatus(env,status);
    return status;
  }catch(e:any){
    const status:Status={status:"error",checked_at_utc,...(validId(guild)?{guild_id:guild}:{}),
      error:String(e?.message??e).slice(0,350)};
    await saveStatus(env,status);
    throw e;
  }
}
