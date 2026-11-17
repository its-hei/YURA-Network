// YURA Discord onboarding. No gateway connection or desktop PC required.
interface OnboardingEnv {
  DB: D1Database;
  ADMIN_KEY: string;
  DISCORD_BOT_TOKEN?: string;
}
type Config = { guild: string; welcome: string; staff: string; boomer: string; fc: string; key: string; message?: string; panel_text?: string };
type Mode = "ttv" | "fc" | "both";
type Profile = {
  guild_id: string; discord_id: string; mode: Mode; twitch_login: string;
  twitch_id: string | null; ffxiv_name: string; fc_state: string;
  verify_code: string | null; verify_until: number; review_message: string | null; boomer_granted: number;
};
const prefix = "yura:join:";
const cfgKey = "discord_onboarding_config_v1";
const snowflake = (v: unknown): v is string => typeof v === "string" && /^[0-9]{15,22}$/.test(v);
const safeMentions = { parse: [] };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "access-control-allow-origin": "*" }
});
const ephemeral = (content: string) => response({ type: 4, data: { content, flags: 64, allowed_mentions: safeMentions } });
const hex = (v: string) => Uint8Array.from(v.match(/.{2}/g) || [], b => parseInt(b, 16));
async function config(env: OnboardingEnv): Promise<Config | null> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(cfgKey).first<{value:string}>();
  return row ? JSON.parse(row.value) as Config : null;
}
async function discord(env: OnboardingEnv, path: string, method = "GET", body?: unknown): Promise<any> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("Discord bot token missing.");
  const r = await fetch("https://discord.com/api/v10/" + path, {
    method, headers: { Authorization: "Bot " + env.DISCORD_BOT_TOKEN.trim(), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!r.ok) {
    let code="";
    try { const detail:any=await r.json(); if(Number.isSafeInteger(detail?.code)) code=" / "+detail.code; } catch {}
    throw new Error("Discord API " + r.status + code + " (" + method + " " + path.split("/")[0] + ").");
  }
  return r.status === 204 ? null : r.json();
}
const memberPath = (c: Config, id: string) => "guilds/" + c.guild + "/members/" + id;
async function profile(env: OnboardingEnv, guild: string, id: string) {
  return env.DB.prepare("SELECT * FROM discord_onboarding_profiles WHERE guild_id=?1 AND discord_id=?2").bind(guild,id).first<Profile>();
}
// Treat these as self-declared display names, not authenticated Twitch logins.
function cleanDisplayName(value:unknown):string {
  return String(value ?? "").trim().replace(/\s+/gu," ");
}
function validDisplayName(value:string):boolean {
  // Discord limits nicknames to 32 characters. No platform-specific syntax.
  return value.length>0 && value.length<=32 && !/[\p{Cc}\p{Cf}]/u.test(value);
}
function validNames(ttv:string,ff:string) {
  return (!ttv || validDisplayName(ttv)) && (!ff || validDisplayName(ff));
}
function nicknameKey(value:string):string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_-]+/gu,"");
}
function desiredNick(p:Profile):string {
  const ttv=p.twitch_login || "";
  // Declared character names are display data, not proof of FC membership.
  const ff=p.ffxiv_name || "";
  if(ttv && ff) {
    const ffKey=nicknameKey(ff);
    if(ffKey && ffKey===nicknameKey(ttv)) return ff;
    const both=ttv+" ("+ff+")";
    return both.length<=32 ? both : ttv;
  }
  return ff || ttv;
}
// Report independent outcomes. Boomer is the self-service rules acceptance role;
// an explicitly revoked FC membership still requires an administrator.
function safeDiscordError(error:unknown):string {
  const msg=error instanceof Error ? error.message : "";
  return /^Discord API [0-9]{3}( \/ [0-9]+)? \((GET|POST|PUT|PATCH|DELETE) [a-z0-9_-]+\)\.$/.test(msg)
    ? msg : "Błąd połączenia lub zapisu.";
}
async function reconcile(env: OnboardingEnv, c: Config, p: Profile, previousNick="") {
  const path = memberPath(c,p.discord_id);
  const m = await discord(env,path);
  const roles: string[] = Array.isArray(m.roles) ? m.roles : [];
  const warnings:string[]=[];
  let boomer=roles.includes(c.boomer);
  try {
    // Discord's actual member roles are authoritative for Boomer. Do not let
    // an old success marker (e.g. after testing or rejoining) block registration.
    const wantsBoomer=Boolean(p.twitch_login || p.ffxiv_name);
    if (wantsBoomer!==boomer) {
      await discord(env,path+"/roles/"+c.boomer,wantsBoomer?"PUT":"DELETE");
      boomer=wantsBoomer;
    }
    if(Boolean(p.boomer_granted)!==boomer)
      await env.DB.prepare("UPDATE discord_onboarding_profiles SET boomer_granted=?3 WHERE guild_id=?1 AND discord_id=?2").bind(c.guild,p.discord_id,boomer?1:0).run();
  } catch(e) { warnings.push("Nie udało się zapisać rangi Boomer: "+safeDiscordError(e)); }
  // Temporary open FC registration. Pending profiles (including older requests)
  // are granted on their next interaction. Never restore rejected/revoked FC.
  let fc=roles.includes(c.fc);
  if(!p.ffxiv_name && fc) {
    try {await discord(env,path+"/roles/"+c.fc,"DELETE");fc=false;}
    catch(e) {warnings.push("Nie udało się odebrać rangi FC: "+safeDiscordError(e));}
  } else if(p.ffxiv_name && p.fc_state==="pending") {
    if(!boomer) {
      warnings.push("Ranga FC wymaga aktywnej rangi Boomer.");
    } else {
      try {
        const latest=await profile(env,c.guild,p.discord_id);
        if(latest?.fc_state==="pending") {
          if(!fc) {
            await discord(env,path+"/roles/"+c.fc,"PUT");
            fc=true;
          }
          const write=await env.DB.prepare("UPDATE discord_onboarding_profiles SET fc_state='approved' WHERE guild_id=?1 AND discord_id=?2 AND fc_state='pending'").bind(c.guild,p.discord_id).run();
          if(Number(write.meta.changes??0)===0) {
            const current=await profile(env,c.guild,p.discord_id);
            if(current?.fc_state==="rejected") {
              await discord(env,path+"/roles/"+c.fc,"DELETE");
              fc=false;
            }
          }
        }
      } catch(e) { warnings.push("Nie udało się nadać rangi FC: "+safeDiscordError(e)); }
    }
  } else if(p.ffxiv_name && p.fc_state==="approved" && !fc) {
    warnings.push("Ranga FC została wcześniej odebrana. Tylko administracja może ją przywrócić.");
  }
  const nick=desiredNick(p);
  let nicknameApplied=Boolean(nick && m.nick===nick);
  try {
    if (nick && !nicknameApplied) {
      await discord(env,path,"PATCH",{nick});
      nicknameApplied=true;
    } else if(!nick && previousNick && m.nick===previousNick) {
      await discord(env,path,"PATCH",{nick:null});
    }
  } catch(e) { warnings.push("Nie udało się ustawić pseudonimu: "+safeDiscordError(e)); }
  return {boomer,fc,nicknameApplied,warnings};
}
function button(id: string, label: string, style = 2) { return {type:2,style,custom_id:prefix+id,label}; }
const DEFAULT_PANEL_TEXT="**Rejestracja**\nWybierz Twitch lub Ordo Noctis. Zatwierdzając formularz, akceptujesz regulamin. Możesz dołączyć do obu społeczności. Podaj dokładny login Twitch oraz nick postaci FFXIV, jeśli grasz z nami. Puste pole oznacza brak powiązania z daną społecznością. Ranga Boomer wymaga przynajmniej jednego nicku, a FC – nicku FFXIV. Nicki możesz zmieniać w dowolnej chwili.";
function panel(c:Config) {
  return {
    embeds:[{title:"Witaj u Boomersów!",description:c.panel_text || DEFAULT_PANEL_TEXT,color:0xe89b52}],
    components:[{type:1,components:[button("ttv","Twitch",1),button("fc","Ordo Noctis",1)]},{type:1,components:[button("reset","Resetuj rejestrację",4)]}],
    allowed_mentions:safeMentions
  };
}
function field(id: string,label:string,max:number,initial?:string) {
  return {type:18,label,...(id==="ttv" ? {description:"Podaj dokładny login Twitch – jest niezbędny do poprawnej synchronizacji rang."} : {}),component:{type:4,custom_id:id,style:1,required:false,max_length:max,
    ...(initial ? {value:initial.slice(0,max)} : {})}};
}
function modal(mode: Mode|"edit", previous?:Profile|null) {
  return response({type:9,data:{custom_id:prefix+"form:"+mode,title:mode==="ttv"?"Twitch":mode==="fc"?"Ordo Noctis":"Edytuj rejestrację",components:[
    ...(mode !== "fc" ? [field("ttv","Nick na Twitchu",32,previous?.twitch_login)] : []),
    ...(mode !== "ttv" ? [field("ff","Nick postaci FFXIV",32,previous?.ffxiv_name)] : []),
    ...((mode==="ttv" && previous?.twitch_login || mode==="fc" && previous?.ffxiv_name) ? [{
      type:18,label:"Usuń zapisany nick",
      description:"Zaznacz i kliknij Wyślij, aby usunąć nick tylko z tej społeczności.",
      component:{type:23,custom_id:"remove_nick",default:false}
    }] : [])
  ]}});
}
function values(components: any[]): Record<string,string> {
  const result: Record<string,string> = Object.create(null);
  function walk(x:any) {
    if (!x || typeof x !== "object") return;
    if (x.type === 4 && typeof x.custom_id === "string") result[x.custom_id] = String(x.value ?? "");
    if (x.type===23 && x.custom_id==="remove_nick") result.remove_nick=x.value===true?"true":"false";
    if (x.component) walk(x.component);
    if (Array.isArray(x.components)) x.components.forEach(walk);
  }
  components.forEach(walk);
  return result;
}
function statusText(p: Profile) {
  const lines = ["Regulamin zaakceptowany."];
  if(p.twitch_login) lines.push("Nick Twitch: "+p.twitch_login+".");
  if(p.ffxiv_name) lines.push("Nick FFXIV: "+p.ffxiv_name+".");
  if(!p.twitch_login&&!p.ffxiv_name) lines.push("Nie zapisano żadnego nicku.");
  if(p.ffxiv_name && p.fc_state==="rejected") lines.push("Dostęp FC został odebrany. Skontaktuj się z administracją.");
  if (desiredNick(p)) lines.push("Docelowy pseudonim: "+desiredNick(p));
  return lines.join("\n");
}
async function finish(env:OnboardingEnv,c:Config,p:Profile,previousNick="") {
  const lines=[statusText(p)];
  try {
    const result=await reconcile(env,c,p,previousNick);
    lines.push("Ranga Boomer: "+(result.boomer?"aktywna.":"nieaktywna."));
    lines.push("Ranga FC (Ordo Noctis): "+(result.fc?"aktywna.":"nieaktywna."));
    if(result.nicknameApplied) lines.push("Pseudonim ustawiony.");
    lines.push(...result.warnings);
  } catch(e) { lines.push("Nie udało się odczytać członka serwera: "+safeDiscordError(e)); }
  return lines.join("\n");
}
async function status(env:OnboardingEnv,c:Config,id:string) {
  let p = await profile(env,c.guild,id);
  if (!p) return "Nie masz jeszcze rejestracji. Wybierz Twitch lub Ordo Noctis.";
  // Retain declared login and any previously verified ID; retire old challenges.
  if (p.verify_code || p.verify_until) {
    await env.DB.prepare("UPDATE discord_onboarding_profiles SET verify_code=NULL,verify_until=0 WHERE guild_id=?1 AND discord_id=?2").bind(c.guild,id).run();
    p = (await profile(env,c.guild,id))!;
  }
  return finish(env,c,p);
}
async function register(env:OnboardingEnv,c:Config,i:any,mode:Mode|"edit",remove=false) {
  const id=String(i.member.user.id);
  const submitted=values(i.data.components||[]);
  remove=remove||((mode==="ttv"||mode==="fc")&&submitted.remove_nick==="true");
  const f=remove?{}:submitted;
  const previous=await profile(env,c.guild,id);
  if(remove && (!previous || (mode==="ttv"?!previous.twitch_login:!previous.ffxiv_name))) return "Nie ma zapisanego nicku w tej społeczności.";
  const ttv=mode==="fc"?(previous?.twitch_login||""):cleanDisplayName(f.ttv).replace(/^@/,"").trim();
  const ff=mode==="ttv"?(previous?.ffxiv_name||""):cleanDisplayName(f.ff);
  if(!validNames(ttv,ff)) return "Nick może mieć do 32 znaków. Możesz też zostawić pole puste.";
  if(!previous&&!ttv&&!ff) return "Nie zapisano rejestracji – oba nicki są puste.";
  const roles:string[]=Array.isArray(i.member.roles)?i.member.roles:[];
  const hadFc=roles.includes(c.fc);
  const mergedMode:Mode=ttv&&ff?"both":ff?"fc":"ttv";
  const initialFc=ff?(hadFc?"approved":"pending"):"none";
  const oldNick=previous?desiredNick(previous):"";
  await env.DB.prepare(`INSERT INTO discord_onboarding_profiles
    (guild_id,discord_id,mode,twitch_login,ffxiv_name,fc_state,verify_code,verify_until)
    VALUES(?1,?2,?3,?4,?5,?6,NULL,0)
    ON CONFLICT(guild_id,discord_id) DO UPDATE SET
      mode=excluded.mode,twitch_login=excluded.twitch_login,ffxiv_name=excluded.ffxiv_name,
      twitch_id=CASE WHEN lower(excluded.twitch_login)<>lower(discord_onboarding_profiles.twitch_login) THEN NULL ELSE discord_onboarding_profiles.twitch_id END,
      fc_state=CASE
        WHEN discord_onboarding_profiles.fc_state='rejected' THEN 'rejected'
        WHEN discord_onboarding_profiles.fc_state='approved' AND excluded.ffxiv_name='' AND ?7=0 THEN 'rejected'
        WHEN excluded.ffxiv_name='' THEN 'none'
        WHEN discord_onboarding_profiles.fc_state IN ('approved','pending') THEN discord_onboarding_profiles.fc_state
        ELSE excluded.fc_state END,
      verify_code=NULL,verify_until=0`)
    .bind(c.guild,id,mergedMode,ttv,ff,initialFc,hadFc?1:0).run();
  const saved=await profile(env,c.guild,id);
  if(!saved) return "Nie udało się zapisać rejestracji.";
  return (remove?"Usunięto nick "+(mode==="ttv"?"Twitch":"Ordo Noctis")+".\n":previous?"Rejestracja zaktualizowana.\n":"")+await finish(env,c,saved,oldNick);
}
// Keep an empty profile as a tombstone: moderation decisions and subscriber
// sync protection must survive a self-service reset. No other roles are touched.
async function resetRegistration(env:OnboardingEnv,c:Config,id:string) {
  const p=await profile(env,c.guild,id);
  if(!p) return "Nie masz rejestracji do zresetowania.";
  const path=memberPath(c,id);
  const m=await discord(env,path);
  const roles:string[]=Array.isArray(m.roles)?m.roles:[];
  const warnings:string[]=[];
  const wasActive=Boolean(p.twitch_login||p.ffxiv_name);
  // Preserve a prior administrative rejection or an approved role removed outside YURA.
  const blocked=p.fc_state==="rejected" || (wasActive && p.fc_state==="approved" && !roles.includes(c.fc));
  const oldNick=desiredNick(p);
  // Store the reset before role removal, so status cannot accidentally restore roles.
  await env.DB.prepare("UPDATE discord_onboarding_profiles SET mode='ttv',twitch_login='',twitch_id=NULL,ffxiv_name='',fc_state=?3,verify_code=NULL,verify_until=0,review_message=NULL,boomer_granted=0 WHERE guild_id=?1 AND discord_id=?2")
    .bind(c.guild,id,blocked?"rejected":"none").run();
  if(oldNick && m.nick===oldNick) {
    try { await discord(env,path,"PATCH",{nick:null}); }
    catch(e) {warnings.push("Nie udało się przywrócić domyślnego pseudonimu: "+safeDiscordError(e));}
  }
  // Repeated reset attempts can finish removing roles after a temporary API error.
  for(const [role,label] of [[c.fc,"FC"],[c.boomer,"Boomer"]] as const) {
    if(!roles.includes(role)) continue;
    try {await discord(env,path+"/roles/"+role,"DELETE");}
    catch(e) {warnings.push("Nie udało się odebrać rangi "+label+": "+safeDiscordError(e));}
  }
  return ["Rejestracja zresetowana. Możesz wybrać Twitch lub Ordo Noctis od nowa.",
    ...(blocked?["Wcześniejsza blokada FC pozostaje aktywna."]:[]),
    ...warnings].join("\n");
}
async function verifySignature(req:Request,body:string,key:string) {
  const sig=req.headers.get("X-Signature-Ed25519") || "";
  const ts=req.headers.get("X-Signature-Timestamp") || "";
  if (!/^[0-9a-f]{128}$/i.test(sig) || !/^[0-9a-f]{64}$/i.test(key) || !/^\d{1,12}$/.test(ts) || Math.abs(Date.now()/1000-Number(ts))>300) return false;
  try {
    const publicKey=await crypto.subtle.importKey("raw",hex(key),{name:"Ed25519"},false,["verify"]);
    return await crypto.subtle.verify({name:"Ed25519"},publicKey,hex(sig),new TextEncoder().encode(ts+body));
  } catch { return false; }
}
async function followup(i:any, content:string, clearComponents=false) {
  const r=await fetch("https://discord.com/api/v10/webhooks/"+i.application_id+"/"+i.token+"/messages/@original",{
    method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({content,allowed_mentions:safeMentions,...(clearComponents?{components:[]}: {})})
  });
  if (!r.ok) console.warn("YURA Discord onboarding follow-up:",r.status);
}
export async function discordOnboardingInteraction(req:Request,env:OnboardingEnv,ctx:ExecutionContext) {
  const raw=await req.text();
  const c=await config(env);
  if (!c || !await verifySignature(req,raw,c.key)) return new Response("invalid signature",{status:401});
  let i:any; try {i=JSON.parse(raw);} catch {return new Response("bad JSON",{status:400});}
  if (i.type===1) return response({type:1});
  if (i.guild_id!==c.guild || !snowflake(i.member?.user?.id) || i.member.user.bot) return ephemeral("Rejestracja jest niedostępna.");
  const id=String(i.data?.custom_id||"");
  if (!id.startsWith(prefix)) return ephemeral("Nieobsługiwana akcja.");
  const action=id.slice(prefix.length);
  if (!/^((approve|reject):[0-9]{15,22})$/.test(action) && i.channel_id!==c.welcome) return ephemeral("Użyj aktualnego panelu w kanale zasad.");
  if(i.type===3 && (action==="ttv" || action==="fc")) {
    const previous=await profile(env,c.guild,i.member.user.id);
    return modal(action,previous);
  }
  if(i.type===3 && (action==="open:ttv" || action==="open:fc")) {
    return modal(action==="open:ttv"?"ttv":"fc",await profile(env,c.guild,i.member.user.id));
  }
  // Compatibility for older published panels; new panels show neither button.
  if(i.type===3 && (action==="both" || action==="edit")) {
    return modal(action,await profile(env,c.guild,i.member.user.id));
  }
  if(i.type===3 && action==="community-cancel") return response({type:7,data:{content:"Anulowano.",components:[],allowed_mentions:safeMentions}});
  if(i.type===3 && action==="reset") return response({type:4,data:{
    content:"Czy na pewno zresetować rejestrację? Usuniemy zapisane nicki i powiązanie Twitch oraz odbierzemy rangi Boomer i FC. Inne rangi pozostaną bez zmian.",
    flags:64,allowed_mentions:safeMentions,
    components:[{type:1,components:[button("reset-confirm","Tak, resetuj",4),button("reset-cancel","Anuluj")]}]
  }});
  if(i.type===3 && action==="reset-cancel") return response({type:7,data:{content:"Anulowano reset rejestracji.",components:[],allowed_mentions:safeMentions}});
  const removeCommunity=i.type===3 && (action==="remove:ttv" || action==="remove:fc");
  let job: (()=>Promise<string>)|undefined;
  if(removeCommunity) job=()=>register(env,c,i,action==="remove:ttv"?"ttv":"fc",true);
  if (i.type===3 && action==="reset-confirm") job=()=>resetRegistration(env,c,i.member.user.id);
  if (i.type===3 && action==="status") job=()=>status(env,c,i.member.user.id);
  if (i.type===5 && /^form:(ttv|fc|both|edit)$/.test(action)) job=()=>register(env,c,i,action.slice(5) as Mode|"edit");
  if (i.type===3 && /^(approve|reject):[0-9]{15,22}$/.test(action)) return ephemeral("Ranga FC jest obecnie nadawana automatycznie. Zarządzaj rangami w YURA Desktop.");
  if (!job) return ephemeral("Nieobsługiwana akcja.");
  const run=job;
  ctx.waitUntil((async()=>{let out:string;try{out=await run();}catch{out="Wystąpił błąd rejestracji. Spróbuj ponownie lub skontaktuj się z administracją.";} await followup(i,out,removeCommunity);})());
  if(removeCommunity) return response({type:6});
  if(i.type===3 && action==="reset-confirm") return response({type:7,data:{content:"Resetowanie rejestracji…",components:[],allowed_mentions:safeMentions}});
  return response({type:5,data:{flags:64}});
}
// Verification is disabled for now. Do not promote a self-declared login to a
// verified Twitch ID (subscriber sync must not confuse the two).
export async function verifyOnboardingChat(_env:OnboardingEnv,_login:string,_twitchId:string,_text:string):Promise<string|null> {
  return "Weryfikacja nicku nie jest obecnie wymagana. Użyj panelu rejestracji na Discordzie.";
}
async function saveConfig(env:OnboardingEnv,c:Config) {
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(cfgKey,JSON.stringify(c)).run();
}
// The Worker router validates the existing administrative key or broadcaster OAuth before calling this.
export async function discordOnboardingAdmin(req:Request,env:OnboardingEnv) {
  const url=new URL(req.url);
  try {
    if(req.method==="GET") {
      const c=await config(env);
      if(!c) return response({ok:true,configured:false,panel_text:DEFAULT_PANEL_TEXT,profiles:[]});
      if(url.searchParams.get("import_rules")==="1") {
        const sourceId=(url.searchParams.get("message_id")||"").trim();
        if(sourceId && (!snowflake(sourceId)||sourceId===c.message)) return response({error:"Select the original rules message, not the YURA panel."},400);
        let candidates:any[];
        if(sourceId) candidates=[await discord(env,"channels/"+c.welcome+"/messages/"+sourceId)];
        else {
          const messages=await discord(env,"channels/"+c.welcome+"/messages?limit=50");
          candidates=(Array.isArray(messages)?messages:[]).filter((m:any)=>!m.author?.bot && m.id!==c.message && /regulamin/i.test(String(m.content||"")));
        }
        if(candidates.length!==1) return response({error:"Could not uniquely identify the rules. Paste the original message link or ID."},409);
        const m=candidates[0];
        const raw=String(m.content||"").trim();
        if(!raw) return response({error:"The selected message has no text to import."},400);
        const rules=raw.split(/\r?\n/).filter(line=>!/^\s*(?:\*\*)?regulamin akceptujesz używając reakcji/i.test(line)).join("\n").trim();
        const imported=rules+"\n\n"+DEFAULT_PANEL_TEXT;
        if(imported.length>4096) return response({error:"Combined text exceeds 4096 characters. Shorten it in the editor."},400);
        return response({ok:true,panel_text:imported});
      }
      const rows=await env.DB.prepare("SELECT discord_id,mode,twitch_login,twitch_id,ffxiv_name,fc_state FROM discord_onboarding_profiles WHERE guild_id=?1 ORDER BY discord_id").bind(c.guild).all();
      return response({ok:true,configured:true,guild:c.guild,welcome:c.welcome,staff:c.staff,boomer:c.boomer,fc:c.fc,message:c.message||"",panel_text:c.panel_text||DEFAULT_PANEL_TEXT,profiles:rows.results||[]});
    }
    if(req.method==="PUT") {
      const x:any=await req.json();
      if(![x.guild,x.welcome,x.staff,x.boomer,x.fc].every(snowflake) || x.welcome===x.staff || x.boomer===x.fc || x.boomer===x.guild || x.fc===x.guild) return response({error:"select distinct valid channels and roles"},400);
      const old=await config(env);
      if(old && (old.guild!==x.guild || old.boomer!==x.boomer || old.fc!==x.fc)) return response({error:"Existing onboarding guild/roles cannot be replaced automatically."},409);
      const [app,roles,welcome,staff]=await Promise.all([discord(env,"oauth2/applications/@me"),discord(env,"guilds/"+x.guild+"/roles"),discord(env,"channels/"+x.welcome),discord(env,"channels/"+x.staff)]);
      if(welcome.guild_id!==x.guild || staff.guild_id!==x.guild || ![0,5].includes(welcome.type) || staff.type!==0) return response({error:"channels must be text channels of the selected guild"},400);
      const dangerous=8n|32n|268435456n|536870912n|2n|4n|8192n|1099511627776n;
      for(const id of [x.boomer,x.fc]) {
        const role=roles.find((r:any)=>r.id===id);
        if(!role || role.managed || (BigInt(role.permissions||"0") & dangerous)!==0n) return response({error:"onboarding roles cannot be managed or privileged"},400);
      }
      const key=String(app.verify_key||"");
      if(!/^[a-f0-9]{64}$/i.test(key)) return response({error:"Discord application verification key unavailable"},502);
      const c:Config={guild:x.guild,welcome:x.welcome,staff:x.staff,boomer:x.boomer,fc:x.fc,key,...(old?.welcome===x.welcome&&old.message?{message:old.message}:{}),...(old?.panel_text?{panel_text:old.panel_text}:{})};
      if(typeof x.panel_text==="string" && x.panel_text.trim()) {
        if(x.panel_text.length>4096) return response({error:"Message cannot exceed 4096 characters."},400);
        c.panel_text=x.panel_text.trim();
      }
      await saveConfig(env,c);
      return response({ok:true,endpoint:url.origin+"/discord/interactions",message:c.message||""});
    }
    if(req.method==="PATCH") {
      const c=await config(env);
      const x:any=await req.json();
      if(!c || !snowflake(x.discord_id) || !["approve_fc","revoke_fc"].includes(x.action))
        return response({error:"invalid member/action"},400);
      let p=await profile(env,c.guild,x.discord_id);
      if(!p || p.mode==="ttv") return response({error:"no FC request"},404);
      const approved=x.action==="approve_fc";
      // Explicit broadcaster action only. No self-service regeneration of FC roles.
      await discord(env,memberPath(c,p.discord_id)+"/roles/"+c.fc,approved?"PUT":"DELETE");
      await env.DB.prepare("UPDATE discord_onboarding_profiles SET fc_state=?3 WHERE guild_id=?1 AND discord_id=?2").bind(c.guild,p.discord_id,approved?"approved":"rejected").run();
      p=(await profile(env,c.guild,p.discord_id))!;
      let warning="";
      try {warning=(await reconcile(env,c,p)).warnings.join(" • ");} catch {warning="Role updated, but member lookup failed.";}
      return response({ok:true,warning});
    }
    if(req.method==="POST") {
      const c=await config(env);
      if(!c) return response({error:"configure onboarding first"},400);
      const raw=await req.text();
      if(raw.trim()) {
        let body:any;try{body=JSON.parse(raw);}catch{return response({error:"Invalid JSON"},400);}
        if(typeof body.panel_text!=="string"||!body.panel_text.trim()||body.panel_text.length>4096)
          return response({error:"Message must contain 1–4096 characters."},400);
        c.panel_text=body.panel_text.trim();
      }
      let msg:any;
      if(c.message) {
        // Do not duplicate a panel if a transient API error occurs.
        msg=await discord(env,"channels/"+c.welcome+"/messages/"+c.message,"PATCH",panel(c));
      } else {
        msg=await discord(env,"channels/"+c.welcome+"/messages","POST",panel(c));
      }
      await saveConfig(env,{...c,message:String(msg.id)});
      return response({ok:true,message:msg.id});
    }
    return response({error:"method not allowed"},405);
  } catch(e:any) { return response({error:String(e?.message||"onboarding failed").slice(0,200)},502); }
}
