import {discordFfxivRequest} from "./ffxiv-discord-api.ts";
import {syncFcLinkshell,fcLinkshellStatus} from "./discord-fc-linkshell.ts";

// All required roles are AND'ed. Existing FC Linkshell is a protected,
// default-on rule whose channel permission policy remains in the legacy gate.
type Env={DB:D1Database;DISCORD_BOT_TOKEN?:string};
type Role={id:string;name:string;position:number;permissions:string;managed?:boolean};
type Member={user?:{id?:string;bot?:boolean};roles?:string[]};
export type AutoRule={id:string;name:string;required_role_ids:string[];target_role_id:string;enabled:boolean};
type Config={revision:number;builtin_enabled:boolean;rules:AutoRule[]};
const CONFIG="discord_auto_roles_config_v1",STATUS="discord_auto_roles_last_sync_v1";
const SNOW=/^[0-9]{15,22}$/,RULEID=/^auto-[a-z0-9-]{6,50}$/;
const ADMIN=8n,MANAGE_ROLES=1n<<28n,MAX_CHANGES=25;
// Never automatically hand out administrative or moderation capabilities.
// A technical access role may grant channel visibility, not management powers.
const BLOCKED_ROLE_PERMISSIONS=[1,2,3,4,5,7,13,17,22,23,24,27,28,29,30,33,34,40,41,51,52]
  .reduce((mask,bit)=>mask|(1n<<BigInt(bit)),0n);
const api=discordFfxivRequest;
async function read(env:Env,key:string){
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value??"");
}
async function write(env:Env,key:string,value:unknown){
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,JSON.stringify(value)).run();
}
async function config(env:Env):Promise<Config>{
  const raw=await read(env,CONFIG);
  if(!raw)return {revision:0,builtin_enabled:true,rules:[]};
  const x=JSON.parse(raw);
  if(!Number.isSafeInteger(x.revision)||x.revision<0||
    typeof x.builtin_enabled!=="boolean"||!Array.isArray(x.rules))
    throw new Error("Stored Discord auto-role configuration is invalid");
  return x as Config;
}
async function guild(env:Env){
  const obj=JSON.parse(await read(env,"discord_onboarding_config_v1")||"{}");
  if(!SNOW.test(String(obj.guild??"")))throw new Error("Discord onboarding is not configured");
  return String(obj.guild);
}
function botHighest(roles:Role[],ids:string[]):number{
  return Math.max(0,...roles.filter(r=>ids.includes(r.id)).map(r=>Number(r.position)||0));
}
export function validateAutoRules(raw:unknown,roles:Role[],botRoles:string[],guildId:string):AutoRule[]{
  if(!Array.isArray(raw)||raw.length>12)throw new Error("Maximum 12 automatic role rules");
  const map=new Map(roles.map(r=>[r.id,r]));
  const reserved=new Set(roles.filter(r=>["FC XIV","FC","XIV","Y.U.R.A.","Admin","VIP","Boomer"].includes(r.name)).map(r=>r.id));
  const seen=new Set<string>(),targets=new Set<string>(),highest=botHighest(roles,botRoles);
  return raw.map((x:any)=>{
    const id=String(x?.id??""),name=String(x?.name??"").trim();
    const target=String(x?.target_role_id??""),required=x?.required_role_ids;
    if(!RULEID.test(id)||seen.has(id))throw new Error("Rule ID is invalid or duplicated");
    if(!name||name.length>60||/[\r\n]/.test(name))throw new Error("Rule name must be 1–60 characters");
    if(typeof x.enabled!=="boolean")throw new Error("Rule enabled state must be boolean");
    if(!Array.isArray(required)||required.length<2||required.length>4||
      required.some((v:unknown)=>typeof v!=="string"||!SNOW.test(v))||
      new Set(required).size!==required.length)throw new Error("Choose 2–4 distinct required roles");
    if(!SNOW.test(target)||target===guildId||required.includes(target)||
      reserved.has(target)||targets.has(target))throw new Error("Target role is reserved, repeated or required");
    const r=map.get(target);
    if(!r||r.managed||(BigInt(r.permissions||"0")&BLOCKED_ROLE_PERMISSIONS)!==0n||
      Number(r.position)>=highest)throw new Error("Target role cannot be managed safely by YURA");
    if(required.some((v:string)=>v===guildId||!map.has(v)))throw new Error("Required role does not exist");
    seen.add(id);targets.add(target);
    return {id,name,required_role_ids:[...required],target_role_id:target,enabled:x.enabled};
  });
}
export function planAutoRoleChanges(members:Member[],rules:AutoRule[]){
  const add:{user:string;rule:string}[]=[],remove:{user:string;rule:string}[]=[];
  let eligible=0;
  for(const m of members){
    if(m.user?.bot===true)continue;
    const id=String(m.user?.id??"");
    if(!SNOW.test(id)||!Array.isArray(m.roles))throw new Error("Discord membership data incomplete");
    for(const rule of rules.filter(r=>r.enabled)){
      const should=rule.required_role_ids.every(r=>m.roles!.includes(r));
      const has=m.roles.includes(rule.target_role_id);
      if(should)eligible++;
      if(should&&!has)add.push({user:id,rule:rule.id});
      if(!should&&has)remove.push({user:id,rule:rule.id});
    }
  }
  return {add,remove,eligible};
}
async function listMembers(env:Env,id:string):Promise<Member[]>{
  const output:Member[]=[],seen=new Set<string>();
  let after="";
  for(let page=0;page<21;page++){
    const r=await api(env,"guilds/"+id+"/members?limit=1000"+(after?"&after="+after:""));
    if(!Array.isArray(r)||r.length>1000)throw new Error("Discord member page invalid");
    for(const m of r as Member[]){
      const uid=String(m.user?.id??"");
      if(!SNOW.test(uid)||seen.has(uid)||!Array.isArray(m.roles)||
        (after&&BigInt(uid)<=BigInt(after)))throw new Error("Discord member scan incomplete");
      seen.add(uid);output.push(m);
    }
    if(output.length>20000)throw new Error("Discord member scan exceeded limit");
    if(r.length<1000){
      if(!output.length)throw new Error("No members returned; refusing role removal");
      return output;
    }
    after=String(r.at(-1)?.user?.id??"");
  }
  throw new Error("Discord member scan did not finish");
}
async function rolesFor(env:Env,id:string){
  const [list,identity]=await Promise.all([api(env,"guilds/"+id+"/roles"),api(env,"users/@me")]);
  if(!Array.isArray(list)||!SNOW.test(String(identity?.id??"")))
    throw new Error("Discord roles / YURA identity unavailable");
  const member=await api(env,"guilds/"+id+"/members/"+identity.id);
  if(!Array.isArray(member.roles))throw new Error("Discord YURA member roles unavailable");
  const roles=list as Role[],ids=member.roles as string[];
  const p=roles.filter(r=>r.id===id||ids.includes(r.id))
    .reduce((sum,r)=>sum|BigInt(r.permissions||"0"),0n);
  if((p&(ADMIN|MANAGE_ROLES))===0n)throw new Error("YURA lacks Manage Roles");
  return {roles,botRoles:ids};
}
export async function getDiscordAutoRoles(env:Env){
  const id=await guild(env);
  const c=await config(env);
  const roles=await api(env,"guilds/"+id+"/roles");
  if(!Array.isArray(roles))throw new Error("Discord roles unavailable");
  const one=(name:string)=>{
    const hits=roles.filter((r:Role)=>r.name===name);
    return hits.length===1?String(hits[0].id):"";
  };
  const status=await read(env,STATUS);
  return {ok:true,revision:c.revision,builtin_enabled:c.builtin_enabled,
    builtin:{id:"fc-linkshell",name:"FC Linkshell",enabled:c.builtin_enabled,locked:true,
      required_role_ids:[one("XIV"),one("FC")],target_role_id:one("FC XIV")},
    rules:c.rules,last_sync:status?JSON.parse(status):null,fc_status:await fcLinkshellStatus(env)};
}
export async function saveDiscordAutoRoles(env:Env,body:unknown){
  const b=body as any,c=await config(env);
  if(!Number.isSafeInteger(b?.revision)||b.revision!==c.revision)
    throw new Error("Rules changed in Cloud. Reload before saving");
  if(typeof b?.builtin_enabled!=="boolean")throw new Error("Invalid FC Linkshell toggle");
  const id=await guild(env),{roles,botRoles}=await rolesFor(env,id);
  const rules=validateAutoRules(b.rules,roles,botRoles,id);
  const updated:Config={revision:c.revision+1,builtin_enabled:b.builtin_enabled,rules};
  await write(env,CONFIG,updated);
  return {ok:true,...updated};
}
// Fast path used by YURA self-role buttons. Never scans other members.
export async function reconcileDiscordAutoRolesMember(env:Env,guildId:string,userId:string){
  if(!SNOW.test(guildId)||!SNOW.test(userId)||guildId!==await guild(env))
    throw new Error("Invalid Discord member for auto-role reconciliation");
  const c=await config(env);
  if(!c.builtin_enabled&&!c.rules.some(r=>r.enabled))return {added:0,removed:0};
  const {roles,botRoles}=await rolesFor(env,guildId);
  const active=validateAutoRules(c.rules,roles,botRoles,guildId).filter(r=>r.enabled);
  if(c.builtin_enabled){
    const named=(name:string)=>{
      const hits=roles.filter(r=>r.name===name);
      if(hits.length!==1)throw new Error("Missing or ambiguous Discord role "+name);
      return hits[0];
    };
    const xiv=named("XIV"),fc=named("FC"),target=named("FC XIV");
    if(target.managed||Number(target.position)>=botHighest(roles,botRoles)||
       (BigInt(target.permissions||"0")&BLOCKED_ROLE_PERMISSIONS)!==0n)
      throw new Error("FC XIV cannot be safely managed by YURA");
    active.push({id:"fc-linkshell",name:"FC Linkshell",
      required_role_ids:[xiv.id,fc.id],target_role_id:target.id,enabled:true});
  }
  const member=await api(env,"guilds/"+guildId+"/members/"+userId);
  if(!Array.isArray(member?.roles)||member?.user?.bot===true)
    throw new Error("Discord member role list unavailable");
  const held=new Set<string>(member.roles);
  let added=0,removed=0;
  for(const rule of active){
    const should=rule.required_role_ids.every(id=>held.has(id));
    const has=held.has(rule.target_role_id);
    if(should===has)continue;
    await api(env,"guilds/"+guildId+"/members/"+userId+"/roles/"+rule.target_role_id,
      should?"PUT":"DELETE");
    if(should){added++;held.add(rule.target_role_id);}
    else{removed++;held.delete(rule.target_role_id);}
  }
  return {added,removed};
}
export async function syncDiscordAutoRoles(env:Env){
  const result={status:"ready",checked_at_utc:new Date().toISOString(),added:0,removed:0,
    members:0,eligible:0,pending:0,builtin_status:"disabled",errors:[] as string[]};
  try{
    const c=await config(env),id=await guild(env);
    if(c.builtin_enabled){
      try{
        const r=await syncFcLinkshell(env);
        result.builtin_status=r.status;result.added+=r.added||0;result.removed+=r.removed||0;
        result.eligible+=r.eligible||0;result.members=Math.max(result.members,r.members||0);
        result.pending+=r.pending||0;
        if(r.status==="partial")result.status="partial";
      }catch(e:any){
        result.builtin_status="error";
        result.errors.push("FC Linkshell: "+String(e?.message??e).slice(0,130));
      }
    }
    if(c.rules.some(r=>r.enabled)){
      const {roles,botRoles}=await rolesFor(env,id);
      const selected=validateAutoRules(c.rules,roles,botRoles,id).filter(r=>r.enabled);
      const members=await listMembers(env,id);
      result.members=Math.max(result.members,members.filter(m=>!m.user?.bot).length);
      const plan=planAutoRoleChanges(members,selected);
      result.eligible+=plan.eligible;
      const changes=[...plan.remove,...plan.add];
      result.pending+=Math.max(0,changes.length-MAX_CHANGES);
      for(const step of changes.slice(0,MAX_CHANGES)){
        if((await config(env)).revision!==c.revision)
          throw new Error("Rule configuration changed during synchronization");
        const rule=selected.find(r=>r.id===step.rule)!;
        let m:Member;
        try{m=await api(env,"guilds/"+id+"/members/"+step.user);}
        catch(e){if(String(e).includes("HTTP 404"))continue;throw e;}
        if(!Array.isArray(m.roles)||m.user?.bot===true)
          throw new Error("Member roles unavailable during sync");
        const should=rule.required_role_ids.every(r=>m.roles!.includes(r));
        const has=m.roles.includes(rule.target_role_id);
        if(should===has)continue;
        await api(env,"guilds/"+id+"/members/"+step.user+"/roles/"+rule.target_role_id,
          should?"PUT":"DELETE");
        if(should)result.added++;else result.removed++;
      }
      if(result.pending)result.status="partial";
    }
    if(!c.builtin_enabled&&!c.rules.some(r=>r.enabled))result.status="disabled";
    if(result.errors.length)result.status="error";
  }catch(e:any){result.status="error";result.errors.push(String(e?.message??e).slice(0,180));}
  await write(env,STATUS,result);
  return result;
}
