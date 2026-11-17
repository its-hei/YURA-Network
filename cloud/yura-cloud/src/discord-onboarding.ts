// YURA Discord onboarding. No gateway connection or desktop PC required.
interface OnboardingEnv {
  DB: D1Database;
  ADMIN_KEY: string;
  DISCORD_BOT_TOKEN?: string;
}
type Config = { guild: string; welcome: string; staff: string; boomer: string; fc: string; key: string; message?: string };
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
function validNames(mode:Mode,ttv:string,ff:string) {
  return (mode==="fc" || validDisplayName(ttv)) &&
    (mode==="ttv" || validDisplayName(ff));
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
    const both=ff+" ("+ttv+")";
    return both.length<=32 ? both : ff;
  }
  return ff || ttv;
}
// Report independent outcomes; never restore a deliberately removed role.
function safeDiscordError(error:unknown):string {
  const msg=error instanceof Error ? error.message : "";
  return /^Discord API [0-9]{3}( \/ [0-9]+)? \((GET|POST|PUT|PATCH|DELETE) [a-z0-9_-]+\)\.$/.test(msg)
    ? msg : "Błąd połączenia lub zapisu.";
}
async function reconcile(env: OnboardingEnv, c: Config, p: Profile) {
  const path = memberPath(c,p.discord_id);
  const m = await discord(env,path);
  const roles: string[] = Array.isArray(m.roles) ? m.roles : [];
  const warnings:string[]=[];
  let boomer=roles.includes(c.boomer);
  try {
    if (!p.boomer_granted) {
      if (!boomer) {
        await discord(env,path + "/roles/" + c.boomer,"PUT");
        boomer=true;
      }
      await env.DB.prepare("UPDATE discord_onboarding_profiles SET boomer_granted=1 WHERE guild_id=?1 AND discord_id=?2").bind(c.guild,p.discord_id).run();
    } else if (!boomer) {
      warnings.push("Ranga Boomer została wcześniej odebrana. Tylko administracja może ją przywrócić.");
    }
  } catch(e) { warnings.push("Nie udało się zapisać rangi Boomer: "+safeDiscordError(e)); }
  const nick=desiredNick(p);
  let nicknameApplied=Boolean(nick && m.nick===nick);
  try {
    if (nick && !nicknameApplied) {
      await discord(env,path,"PATCH",{nick});
      nicknameApplied=true;
    }
  } catch(e) { warnings.push("Nie udało się ustawić pseudonimu: "+safeDiscordError(e)); }
  return {boomer,nicknameApplied,warnings};
}
function button(id: string, label: string, style = 2) { return {type:2,style,custom_id:prefix+id,label}; }
function panel() {
  return {
    embeds:[{title:"Witaj u Boomersów!",description:"Wybierz społeczność i podaj swój nick. Zatwierdzając formularz, akceptujesz regulamin. Ranga Boomer zostanie przyznana automatycznie. Dostęp do FC wymaga akceptacji administracji. Nicki przyjmujemy bez dodatkowej weryfikacji. Jeśli na Twitchu i w FFXIV używasz tej samej nazwy, wpisz ją w obu polach. Nicki możesz poprawić w dowolnej chwili. Pseudonim na serwerze powinien odpowiadać nazwie z Twitcha lub FFXIV.",color:0xe89b52}],
    components:[{type:1,components:[button("ttv","Twitch",1),button("fc","Free Company",1),button("both","Twitch + FC",1)]},{type:1,components:[button("status","Moja rejestracja"),button("edit","Edytuj nicki")]}],
    allowed_mentions:safeMentions
  };
}
function field(id: string,label:string,max:number,initial?:string) {
  return {type:18,label,component:{type:4,custom_id:id,style:1,required:true,max_length:max,
    ...(initial ? {value:initial.slice(0,max)} : {})}};
}
function modal(mode: Mode, previous?:Profile|null) {
  return response({type:9,data:{custom_id:prefix+"form:"+mode,title:previous?"Edytuj rejestrację":"Rejestracja Boomersów",components:[
    ...(mode !== "fc" ? [field("ttv","Nick na Twitchu",32,previous?.twitch_login)] : []),
    ...(mode !== "ttv" ? [field("ff","Nick postaci FFXIV",32,previous?.ffxiv_name)] : [])
  ]}});
}
function values(components: any[]): Record<string,string> {
  const result: Record<string,string> = Object.create(null);
  function walk(x:any) {
    if (!x || typeof x !== "object") return;
    if (x.type === 4 && typeof x.custom_id === "string") result[x.custom_id] = String(x.value ?? "");
    if (x.component) walk(x.component);
    if (Array.isArray(x.components)) x.components.forEach(walk);
  }
  components.forEach(walk);
  return result;
}
async function review(env: OnboardingEnv,c:Config,p:Profile) {
  if (p.fc_state !== "pending") return;
  const payload={
    embeds:[{title:"Prośba o dołączenie do FC",description:"Użytkownik: <@"+p.discord_id+">\nPostać: "+p.ffxiv_name+"\nTwitch: "+(p.twitch_login||"—"),color:0xe89b52}],
    components:[{type:1,components:[button("approve:"+p.discord_id,"Zatwierdź FC",3),button("reject:"+p.discord_id,"Odrzuć",4)]}],
    allowed_mentions:safeMentions
  };
  if(p.review_message) {
    // An edit updates the pending request rather than creating a second one.
    await discord(env,"channels/"+c.staff+"/messages/"+p.review_message,"PATCH",payload);
    return;
  }
  const m=await discord(env,"channels/"+c.staff+"/messages","POST",{
    ...payload,nonce:p.discord_id,enforce_nonce:true
  });
  await env.DB.prepare("UPDATE discord_onboarding_profiles SET review_message=?3 WHERE guild_id=?1 AND discord_id=?2").bind(c.guild,p.discord_id,m.id).run();
}
function statusText(p: Profile) {
  const lines = ["Regulamin zaakceptowany."];
  if (p.mode !== "fc") {
    lines.push("Nick Twitch: "+p.twitch_login+".");
  }
  if (p.mode !== "ttv") lines.push("Nick FFXIV: "+p.ffxiv_name+".");
  if (p.mode !== "ttv") lines.push(p.fc_state === "approved" ? "FC zatwierdzone." : p.fc_state === "rejected" ? "FC odrzucone. Skontaktuj się z administracją." : "FC oczekuje na akceptację administracji.");
  if (desiredNick(p)) lines.push("Docelowy pseudonim: "+desiredNick(p));
  return lines.join("\n");
}
async function finish(env:OnboardingEnv,c:Config,p:Profile) {
  const lines=[statusText(p)];
  try {
    const result=await reconcile(env,c,p);
    if(result.boomer) lines.push("Ranga Boomer: aktywna.");
    if(result.nicknameApplied) lines.push("Pseudonim ustawiony.");
    lines.push(...result.warnings);
  } catch(e) { lines.push("Nie udało się odczytać członka serwera: "+safeDiscordError(e)); }
  try {
    await review(env,c,p);
    if(p.fc_state==="pending") lines.push("Zgłoszenie FC przekazane administracji.");
  } catch(e) {
    lines.push("Nie udało się wysłać lub zaktualizować zgłoszenia FC: "+safeDiscordError(e)+" Sprawdź kanał PRIVATE FC REVIEW i ponów „Moja rejestracja”.");
  }
  return lines.join("\n");
}
async function status(env:OnboardingEnv,c:Config,id:string) {
  let p = await profile(env,c.guild,id);
  if (!p) return "Nie masz jeszcze rejestracji. Wybierz Twitch, FC lub obie społeczności.";
  // Retain declared login and any previously verified ID; retire old challenges.
  if (p.verify_code || p.verify_until) {
    await env.DB.prepare("UPDATE discord_onboarding_profiles SET verify_code=NULL,verify_until=0 WHERE guild_id=?1 AND discord_id=?2").bind(c.guild,id).run();
    p = (await profile(env,c.guild,id))!;
  }
  return finish(env,c,p);
}
async function register(env: OnboardingEnv,c:Config,i:any,mode:Mode) {
  const id = String(i.member.user.id);
  const f = values(i.data.components || []);
  const ttv = mode === "fc" ? "" : cleanDisplayName(f.ttv).replace(/^@/,"").trim();
  const ff = mode === "ttv" ? "" : cleanDisplayName(f.ff);
  if (!validNames(mode,ttv,ff)) return "Podaj nick dla wybranej społeczności (1–32 znaki, bez niewidocznych znaków sterujących). Format i liczba członów są dowolne.";
  const previous = await profile(env,c.guild,id);
  const hadFc = (i.member.roles || []).includes(c.fc);
  const fcState = mode === "ttv" ? "none" : hadFc ? "approved" : "pending";
  // Update only the selected community's fields. Adding the other community
  // merges the registration instead of deleting the first one.
  // Existing FC decisions, review message and Boomer-granted marker stay intact.
  // Changing a declared Twitch identity invalidates a previously verified binding.
  await env.DB.prepare(`INSERT INTO discord_onboarding_profiles
    (guild_id,discord_id,mode,twitch_login,ffxiv_name,fc_state,verify_code,verify_until)
    VALUES(?1,?2,?3,?4,?5,?6,NULL,0)
    ON CONFLICT(guild_id,discord_id) DO UPDATE SET
      mode=CASE WHEN discord_onboarding_profiles.mode=excluded.mode THEN excluded.mode ELSE 'both' END,
      twitch_login=CASE WHEN excluded.mode='fc' THEN discord_onboarding_profiles.twitch_login ELSE excluded.twitch_login END,
      ffxiv_name=CASE WHEN excluded.mode='ttv' THEN discord_onboarding_profiles.ffxiv_name ELSE excluded.ffxiv_name END,
      twitch_id=CASE WHEN excluded.mode<>'fc' AND lower(excluded.twitch_login)<>lower(discord_onboarding_profiles.twitch_login) THEN NULL ELSE discord_onboarding_profiles.twitch_id END,
      fc_state=CASE WHEN discord_onboarding_profiles.fc_state='none' AND excluded.mode<>'ttv' THEN excluded.fc_state ELSE discord_onboarding_profiles.fc_state END,
      verify_code=NULL,verify_until=0`)
    .bind(c.guild,id,mode,ttv,ff,fcState).run();
  return (previous ? "Rejestracja zaktualizowana.\n" : "")+await status(env,c,id);
}
async function decide(env:OnboardingEnv,c:Config,i:any,id:string,approve:boolean) {
  const permissions = BigInt(String(i.member.permissions || "0"));
  if ((permissions & 8n) === 0n || i.channel_id !== c.staff) return "Tylko administrator może zatwierdzić FC w kanale administracji.";
  let p = await profile(env,c.guild,id);
  if (!p || p.mode === "ttv") return "Nie znaleziono zgłoszenia FC.";
  if (p.fc_state === "pending") {
    // Persist the decision before side effects; repeated approval retries reconciliation.
    await env.DB.prepare("UPDATE discord_onboarding_profiles SET fc_state=?3 WHERE guild_id=?1 AND discord_id=?2 AND fc_state='pending'").bind(c.guild,id,approve?"approved":"rejected").run();
    p = (await profile(env,c.guild,id))!;
  }
  if (p.fc_state === "approved" && approve) {
    try {
      await discord(env,memberPath(c,p.discord_id)+"/roles/"+c.fc,"PUT");
      const result=await reconcile(env,c,p);
      if(result.warnings.length) return "FC zatwierdzone: "+p.ffxiv_name+"\n"+result.warnings.join("\n");
    } catch { return "FC zatwierdzone w bazie, lecz Discord nie przyjął wszystkich zmian. Sprawdź hierarchię ról i kliknij ponownie."; }
  }
  return p.fc_state === "approved" ? "FC zatwierdzone: "+p.ffxiv_name : "FC odrzucone: "+p.ffxiv_name;
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
async function followup(i:any, content:string) {
  const r=await fetch("https://discord.com/api/v10/webhooks/"+i.application_id+"/"+i.token+"/messages/@original",{
    method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({content,allowed_mentions:safeMentions})
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
  if (i.type===3 && (action==="ttv" || action==="fc" || action==="both" || action==="edit")) {
    const previous=await profile(env,c.guild,i.member.user.id);
    if(action==="edit") return previous ? modal(previous.mode,previous) : ephemeral("Najpierw wybierz Twitch, Free Company lub Twitch + FC.");
    return modal(action,previous);
  }
  let job: (()=>Promise<string>)|undefined;
  if (i.type===3 && action==="status") job=()=>status(env,c,i.member.user.id);
  if (i.type===5 && /^form:(ttv|fc|both)$/.test(action)) job=()=>register(env,c,i,action.slice(5) as Mode);
  if (i.type===3 && /^(approve|reject):[0-9]{15,22}$/.test(action)) job=()=>decide(env,c,i,action.split(":")[1],action.startsWith("approve:"));
  if (!job) return ephemeral("Nieobsługiwana akcja.");
  const run=job;
  ctx.waitUntil((async()=>{let out:string;try{out=await run();}catch{out="Wystąpił błąd rejestracji. Spróbuj ponownie lub skontaktuj się z administracją.";} await followup(i,out);})());
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
      if(!c) return response({ok:true,configured:false,profiles:[]});
      const rows=await env.DB.prepare("SELECT discord_id,mode,twitch_login,twitch_id,ffxiv_name,fc_state FROM discord_onboarding_profiles WHERE guild_id=?1 ORDER BY discord_id").bind(c.guild).all();
      return response({ok:true,configured:true,guild:c.guild,welcome:c.welcome,staff:c.staff,boomer:c.boomer,fc:c.fc,message:c.message||"",profiles:rows.results||[]});
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
      const c:Config={guild:x.guild,welcome:x.welcome,staff:x.staff,boomer:x.boomer,fc:x.fc,key,...(old?.welcome===x.welcome&&old.message?{message:old.message}:{})};
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
      let msg:any;
      if(c.message) {
        // Do not duplicate a panel if a transient API error occurs.
        msg=await discord(env,"channels/"+c.welcome+"/messages/"+c.message,"PATCH",panel());
      } else {
        msg=await discord(env,"channels/"+c.welcome+"/messages","POST",panel());
      }
      await saveConfig(env,{...c,message:String(msg.id)});
      return response({ok:true,message:msg.id});
    }
    return response({error:"method not allowed"},405);
  } catch(e:any) { return response({error:String(e?.message||"onboarding failed").slice(0,200)},502); }
}
