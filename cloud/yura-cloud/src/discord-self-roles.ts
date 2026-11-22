// YURA self-assignable Discord roles: replaces the legacy Zira reaction roles.
// Uses the existing, Ed25519-verified /discord/interactions webhook; no Gateway needed.
import {discordFfxivRequest} from "./ffxiv-discord-api.ts";
import {reconcileDiscordAutoRolesMember} from "./discord-auto-roles.ts";

type Env={DB:D1Database;DISCORD_BOT_TOKEN?:string};
type Role={id:string;name:string;position:number;permissions:string;managed?:boolean};
type ButtonRole={id:string;label:string};
type Config={revision:number;guild_id:string;channel_id:string;message_id:string;roles:ButtonRole[]};
const KEY="discord_self_roles_panel_v1",STATUS="discord_self_roles_panel_status_v1";
const ID=/^[0-9]{15,22}$/;
const PREFIX="yura:self:";
const BLOCKED=[1,2,3,4,5,7,13,17,22,23,24,27,28,29,30,33,34,40,41,51,52]
  .reduce((bits,position)=>bits|(1n<<BigInt(position)),0n);
const MANAGE_ROLES=1n<<28n,ADMIN=8n;
const api=discordFfxivRequest;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
const snow=(v:unknown):v is string=>typeof v==="string"&&ID.test(v);
async function getMeta(env:Env,key:string):Promise<string>{
  const r=await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(r?.value??"");
}
async function putMeta(env:Env,key:string,value:unknown):Promise<void>{
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key,JSON.stringify(value)).run();
}
async function readConfig(env:Env):Promise<Config|null>{
  const raw=await getMeta(env,KEY);
  if(!raw)return null;
  const c=JSON.parse(raw);
  if(!Number.isSafeInteger(c.revision)||!snow(c.guild_id)||!snow(c.channel_id)||
    (c.message_id!==""&&!snow(c.message_id))||!Array.isArray(c.roles))
    throw new Error("Stored self-role panel configuration is corrupt");
  return c as Config;
}
const allowed=(r:Role|undefined,highest:number)=>!!r&&snow(r.id)&&
  !r.managed&&r.position<highest&&
  (BigInt(r.permissions||"0")&BLOCKED)===0n;
export function isSelfRoleChannel(name:unknown):boolean{
  return typeof name==="string"&&/(?:^|[^a-z0-9])role$/i.test(name.normalize("NFKC").trim());
}
export function validateSelfRoles(input:unknown,roles:Role[],highest:number,guild:string):ButtonRole[]{
  if(!Array.isArray(input)||input.length<1||input.length>10)
    throw new Error("Choose 1-10 self-assignable roles");
  const byId=new Map(roles.map(r=>[r.id,r]));
  const used=new Set<string>();
  return input.map((x:any)=>{
    const id=String(x?.id??""),label=String(x?.label??"").trim();
    if(!snow(id)||id===guild||used.has(id))
      throw new Error("Self-role ID is missing, reserved or duplicated");
    if(!label||label.length>40||/[\r\n]/.test(label))
      throw new Error("Role label must be 1-40 characters");
    if(!allowed(byId.get(id),highest))
      throw new Error("Self role must be unprivileged and below YURA");
    // Never make onboarding/moderation, FC access, Twitch reward or staff roles self-grantable.
    if(["FC","FC XIV","Admin","Y.U.R.A.","VIP","Mod","Boomer","Boomer+","Boomer++","Boomer+++"].includes(byId.get(id)!.name))
      throw new Error("Role is protected against self assignment");
    used.add(id);return {id,label};
  });
}
async function guildId(env:Env):Promise<string>{
  const data=JSON.parse(await getMeta(env,"discord_onboarding_config_v1")||"{}");
  if(!snow(data?.guild))throw new Error("Discord onboarding is not configured");
  return data.guild;
}
async function guildContext(env:Env,guild:string){
  const [list,identity]=await Promise.all([
    api(env,"guilds/"+guild+"/roles"),api(env,"users/@me")
  ]);
  if(!Array.isArray(list)||!snow(identity?.id))throw new Error("Discord roles or YURA identity unavailable");
  const bot=await api(env,"guilds/"+guild+"/members/"+identity.id);
  if(!Array.isArray(bot?.roles))throw new Error("YURA Discord member roles unavailable");
  const roles=list as Role[];
  const highest=Math.max(0,...roles.filter(r=>bot.roles.includes(r.id))
    .map(r=>Number(r.position)||0));
  const permission=roles.filter(r=>r.id===guild||bot.roles.includes(r.id))
    .reduce((bits,r)=>bits|BigInt(r.permissions||"0"),0n);
  if((permission&(MANAGE_ROLES|ADMIN))===0n)
    throw new Error("YURA bot needs Manage Roles permission");
  return {roles,highest};
}
async function channelExists(env:Env,guild:string,channelId:string){
  const channel=await api(env,"channels/"+channelId);
  if(channel.guild_id!==guild||Number(channel.type)!==0)
    throw new Error("Role panel must be published to a text channel in this server");
}
// Only on a missing-permission response, give this particular YURA bot user
// the channel ability to post its role panel. Preserve every existing
// overwrite bit; never modify @everyone, Zira or any member's access.
export async function ensureSelfRoleBotChannelPermission(env:Env,guild:string,channelId:string){
  const [identity,channel]=await Promise.all([
    api(env,"users/@me"),api(env,"channels/"+channelId)
  ]);
  if(!snow(identity?.id)||channel.guild_id!==guild||Number(channel.type)!==0||
     !Array.isArray(channel.permission_overwrites))
    throw new Error("Cannot verify the Discord role channel for a bot-only override");
  const old=channel.permission_overwrites.find((p:any)=>String(p.id)===identity.id&&Number(p.type)===1);
  const required=(1n<<10n)|(1n<<11n)|(1n<<14n)|(1n<<16n);
  const allow=BigInt(String(old?.allow??"0"))|required;
  const deny=BigInt(String(old?.deny??"0"))&~required;
  if(old&&allow===BigInt(String(old.allow))&&deny===BigInt(String(old.deny)))
    throw new Error("Discord denied a message even though the bot-only channel permissions are already granted");
  await api(env,"channels/"+channelId+"/permissions/"+identity.id,"PUT",{
    type:1,allow:allow.toString(),deny:deny.toString()
  });
}
async function defaults(env:Env,guild:string):Promise<Config>{
  const [roles,channels]=await Promise.all([
    api(env,"guilds/"+guild+"/roles"),api(env,"guilds/"+guild+"/channels")
  ]);
  if(!Array.isArray(roles)||!Array.isArray(channels))
    throw new Error("Cannot discover self-role setup");
  const roleByName=(name:string)=>{
    const found=(roles as Role[]).filter(r=>r.name===name);
    return found.length===1?found[0].id:"";
  };
  const matches=channels.filter((c:any)=>c.guild_id===guild&&c.type===0&&isSelfRoleChannel(c.name));
  return {revision:0,guild_id:guild,
    channel_id:matches.length===1?String(matches[0].id):"",
    message_id:"",
    roles:["XIV","Gamba"].map(name=>({id:roleByName(name),label:name})).filter(x=>!!x.id)};
}
export function selfRolePanelPayload(c:Pick<Config,"roles">){
  const actions=c.roles.map(role=>({
    type:2,style:2,custom_id:PREFIX+role.id,label:role.label,
    ...(role.label==="XIV"?{emoji:{name:"🎮"}}:role.label==="Gamba"?{emoji:{name:"🎲"}}:{})
  }));
  const components=[];
  for(let i=0;i<actions.length;i+=5)components.push({type:1,components:actions.slice(i,i+5)});
  return {
    embeds:[{title:"Y.U.R.A. • SELF ROLES",
      description:"Wybierz swoje role na serwerze. Kliknij ponownie, aby usunąć rolę.\nZmiana **XIV** automatycznie aktualizuje dostęp **FC XIV**, jeśli należysz do FC.",
      color:0xe89b52}],
    components,allowed_mentions:{parse:[]}
  };
}
export async function getSelfRolePanel(env:Env){
  const guild=await guildId(env);
  const stored=await readConfig(env);
  const c=stored??await defaults(env,guild);
  if(stored&&c.guild_id!==guild)throw new Error("Self-role configuration belongs to a different server");
  const status=await getMeta(env,STATUS);
  return {ok:true,...c,configured:!!stored,published:!!c.message_id,
    last_status:status?JSON.parse(status):null};
}
export async function saveSelfRolePanel(env:Env,data:unknown){
  const x=data as any,guild=await guildId(env);
  const stored=await readConfig(env);
  const current=stored??await defaults(env,guild);
  if(!Number.isSafeInteger(x?.revision)||x.revision!==current.revision)
    throw new Error("Self-role settings changed. Reload the panel first");
  const channel=String(x?.channel_id??"");
  if(!snow(channel))throw new Error("Select a channel for the role panel");
  await channelExists(env,guild,channel);
  const {roles,highest}=await guildContext(env,guild);
  const validated=validateSelfRoles(x?.roles,roles,highest,guild);
  const next:Config={revision:current.revision+1,guild_id:guild,channel_id:channel,
    message_id:stored?.channel_id===channel?stored.message_id:"",roles:validated};
  await putMeta(env,KEY,next);
  return {ok:true,...next};
}
export async function publishSelfRolePanel(env:Env){
  const guild=await guildId(env);
  const stored=await readConfig(env);
  const c=stored??await defaults(env,guild);
  if(!snow(c.channel_id)||!c.roles.length)
    throw new Error("Choose the Discord #role channel and roles first");
  if(c.guild_id!==guild)throw new Error("Self-role server mismatch");
  await channelExists(env,guild,c.channel_id);
  const {roles,highest}=await guildContext(env,guild);
  c.roles=validateSelfRoles(c.roles,roles,highest,guild);
  const payload=selfRolePanelPayload(c);
  let messageId=c.message_id,operation="updated";
  if(messageId){
    try{await api(env,"channels/"+c.channel_id+"/messages/"+messageId,"PATCH",payload);}
    catch(e){
      // Never overwrite a foreign message or silently duplicate a panel.
      if(!/HTTP 404\b/.test(String(e)))throw e;
      messageId="";
    }
  }
  if(!messageId){
    let msg:any;
    try{
      msg=await api(env,"channels/"+c.channel_id+"/messages","POST",payload);
    }catch(e){
      if(!/Discord POST channels HTTP 403/.test(String(e)))throw e;
      // A bot can edit channel overwrites through Manage Roles; grant only
      // itself VIEW/SEND/EMBED/HISTORY, then retry its own message once.
      await ensureSelfRoleBotChannelPermission(env,guild,c.channel_id);
      msg=await api(env,"channels/"+c.channel_id+"/messages","POST",payload);
    }
    if(!snow(msg?.id))throw new Error("Discord did not return a panel message ID");
    messageId=msg.id;operation="created";
  }
  const next:Config={...c,message_id:messageId};
  await putMeta(env,KEY,next);
  const state={status:"ready",operation,channel_id:c.channel_id,message_id:messageId,
    checked_at_utc:new Date().toISOString(),role_count:c.roles.length};
  await putMeta(env,STATUS,state);
  return {ok:true,...state};
}
// Automatic first publication is safe and idempotent. It NEVER deletes Zira
// messages; it edits only YURA's recorded message, or makes a single new one.
export async function ensureSelfRolePanel(env:Env){
  try{
    const c=await readConfig(env);
    if(c?.message_id)return;
    return await publishSelfRolePanel(env);
  }catch(e:any){
    const message=String(e?.message??e).slice(0,180);
    await putMeta(env,STATUS,{status:"waiting",error:message,checked_at_utc:new Date().toISOString()});
  }
}
export async function handleSelfRoleClick(env:Env,ctx:ExecutionContext,i:any):Promise<Response>{
  const fail=(message:string)=>json({type:4,data:{flags:64,content:message,allowed_mentions:{parse:[]}}});
  const user=String(i.member?.user?.id??""),roleId=String(i.data?.custom_id??"").slice(PREFIX.length);
  const c=await readConfig(env);
  if(i.type!==3||!c?.message_id||i.guild_id!==c.guild_id||
     i.channel_id!==c.channel_id||i.message?.id!==c.message_id||
     !snow(user)||i.member.user?.bot===true||
     !snow(roleId)||!c.roles.some(r=>r.id===roleId))
    return fail("Ten przycisk jest nieaktywny. Użyj aktualnego panelu ról YURY.");
  const role=c.roles.find(r=>r.id===roleId)!;
  ctx.waitUntil((async()=>{
    let result:string;
    try{
      const {roles,highest}=await guildContext(env,c.guild_id);
      validateSelfRoles(c.roles,roles,highest,c.guild_id);
      const before=await api(env,"guilds/"+c.guild_id+"/members/"+user);
      if(!Array.isArray(before?.roles)||before.user?.bot===true)
        throw new Error("Nie udało się pobrać aktualnych ról.");
      const had=before.roles.includes(roleId);
      // Revalidate the saved panel after slow REST calls (avoids stale deleted buttons).
      const latest=await readConfig(env);
      if(!latest||latest.message_id!==c.message_id||
         !latest.roles.some(r=>r.id===roleId))
        throw new Error("Panel został zmieniony. Użyj aktualnej wiadomości.");
      await api(env,"guilds/"+c.guild_id+"/members/"+user+"/roles/"+roleId,had?"DELETE":"PUT");
      result=(had?"Usunięto":"Przyznano")+" rolę **"+role.label+"**.";
      try{
        const cascade=await reconcileDiscordAutoRolesMember(env,c.guild_id,user);
        if(cascade.added||cascade.removed)
          result+=" Zaktualizowano role zależne (+"+cascade.added+" / -"+cascade.removed+").";
      }catch(e:any){
        console.warn("YURA self-role cascade:",String(e?.message??e).slice(0,160));
        result+=" Nie udało się od razu przeliczyć ról zależnych; Cloud ponowi synchronizację.";
      }
    }catch(e:any){
      console.warn("YURA self-role click:",String(e?.message??e).slice(0,180));
      result="Nie udało się zmienić roli. Sprawdź uprawnienia bota i spróbuj ponownie.";
    }
    const callback="https://discord.com/api/v10/webhooks/"+i.application_id+"/"+i.token+"/messages/@original";
    try{
      const response=await fetch(callback,{method:"PATCH",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({content:result,allowed_mentions:{parse:[]}})});
      if(!response.ok)console.warn("YURA self-role response HTTP",response.status);
    }catch(e){console.warn("YURA self-role callback failed",String(e).slice(0,120));}
  })());
  // ACK synchronously within Discord's three-second interaction deadline.
  return json({type:5,data:{flags:64}});
}
export async function selfRolePanelAdmin(req:Request,env:Env):Promise<Response>{
  try{
    if(req.method==="GET")return json(await getSelfRolePanel(env));
    if(req.method==="PUT")return json(await saveSelfRolePanel(env,await req.json()));
    if(req.method==="POST")return json(await publishSelfRolePanel(env));
    return json({ok:false,error:"Method not allowed"},405);
  }catch(e:any){return json({ok:false,error:String(e?.message??e).slice(0,300)},502);}
}
