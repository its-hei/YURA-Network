// Four persistent, editable Discord messages: EVENT, FASHION, PATCH, DALAMUD.
// Every announcement's previous version goes into that message's history
// thread before the main message is edited. No daily no-news posts.
import type {LiveEvent} from "./ffxiv-events";

interface Env {DB:D1Database; DISCORD_BOT_TOKEN?:string}
export type SourceItem={source:string;id:string;title:string;url:string;date:number;image?:string};
export type Sources={
  fashion?:SourceItem;patch?:SourceItem;dalamud?:SourceItem;events:LiveEvent[]|null;
};
export type BoardConfig={guildId:string;channelId:string;fashion:boolean;dalamud:boolean;lodestone:boolean};
type Category="event"|"fashion"|"patch"|"dalamud";
type Current={id:string;title:string;url:string;end?:number;image?:string;expires?:number};
type Post={anchor:string;thread:string;current:Current|null;retiredId?:string};
const ORDER:Category[]=["event","fashion","patch","dalamud"];
const LABEL:Record<Category,string>={
  event:"🎉 AKTUALNY EVENT",fashion:"👗 FASHION REPORT",
  patch:"⚔️ AKTUALNY PATCH",dalamud:"🟢 DALAMUD • STABLE"
};
const LEGACY:Partial<Record<Category,string>>={
  fashion:"fashion",patch:"lodestone",dalamud:"dalamud"
};
const ID=/^\d{15,22}$/;
const NO_PINGS={parse:[]};
const keyFor=(cfg:BoardConfig,category:Category)=>"ffxiv_board_v3_"+cfg.guildId+"_"+cfg.channelId+"_"+category;
const canonical=(category:Category)=>"**"+LABEL[category]+"**";
const safe=(v:unknown,n=160)=>String(v??"").replace(/[\r\n]/g," ").slice(0,n);
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
async function api(env:Env,path:string,method="GET",body?:unknown):Promise<any>{
  if(!env.DISCORD_BOT_TOKEN?.trim())throw new Error("Cloud Discord bot token missing");
  const res=await fetch("https://discord.com/api/v10/"+path,{
    method,headers:{"authorization":"Bot "+env.DISCORD_BOT_TOKEN.trim(),"content-type":"application/json",
      "user-agent":"YURA-FFXIV/4-Posts"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!res.ok)throw new Error("Discord "+method+" "+path.split("/")[0]+" HTTP "+res.status);
  return res.status===204?null:res.json();
}
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
    ...(x.image?{image:x.image}:{})};
}
function eventCurrent(events:LiveEvent[]|null,at:number):Current|null{
  const active=events?.filter(e=>e.start<=at&&at<e.end).sort((a,b)=>b.start-a.start)[0];
  return toCurrent("event",active,at);
}
function textFor(category:Category,x:Current|null):string{
  const intro=canonical(category);
  if(!x)return intro+"\n"+
    (category==="event"?"Obecnie brak potwierdzonego aktywnego eventu.":
     category==="fashion"?"Raport zakończony — czekamy na nowe rozwiązanie.":
     category==="patch"?"Brak aktualnego wpisu o patchu.":"Nie udało się ustalić stabilnej wersji.");
  switch(category){
    case "event":
      return intro+"\n**"+safe(x.title,160)+"**\n"+
        "Koniec <t:"+Math.floor((x.end||0)/1000)+":f> • <t:"+Math.floor((x.end||0)/1000)+":R>\n"+x.url;
    case "fashion":
      return intro+"\nRozwiązanie na 80/100 pkt • do 60 000 MGP\n"+
        "Koniec tygodnia <t:"+Math.floor((x.expires||0)/1000)+":f>\n"+x.url;
    case "patch":
      return intro+"\n"+safe(x.title,140)+"\n"+x.url;
    case "dalamud":
      return intro+"\n"+safe(x.title,140)+"\n"+x.url;
  }
}
function embedsFor(category:Category,x:Current|null):unknown[]{
  if(!x?.image)return [];
  let url:URL;
  try{url=new URL(x.image);}catch{return [];}
  if(url.protocol!=="https:")return [];
  if(category==="fashion" && url.hostname!=="fashionreportxiv.com")return [];
  if(category==="event" && !/(?:^|\.)finalfantasyxiv\.com$/.test(url.hostname))return [];
  if(category!=="event" && category!=="fashion")return [];
  return [{color:0xe89b52,image:{url:url.toString()},
    ...(category==="fashion"?{title:"80 / 100 punktów • Fashion Report",url:x.url}:{title:safe(x.title,170),url:x.url})}];
}
function changed(a:Current|null,b:Current|null):boolean{
  // Ignore fetched-at timestamps and cache-busting changes. Expiry is a
  // property of the weekly instance, not a reason to republish daily.
  return a?.id!==b?.id || a?.url!==b?.url;
}
async function ensurePost(env:Env,cfg:BoardConfig,cat:Category,existing:any[]):Promise<Post>{
  const saved=await loadPost(env,cfg,cat);
  if(saved){
    try{
      const [post,t]=await Promise.all([
        api(env,"channels/"+cfg.channelId+"/messages/"+saved.anchor),
        api(env,"channels/"+saved.thread)
      ]);
      if(String(post?.content??"").startsWith(canonical(cat)) &&
        String(t.parent_id)===cfg.channelId && [11,12].includes(Number(t.type)))return saved;
    }catch{/* Recover from deleted post or thread. */}
  }
  const found=existing.find(m=>m.author?.bot===true && String(m.content??"").startsWith(canonical(cat)));
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
  const state:Post={anchor:id,thread,current:saved?.current||null,...(saved?.retiredId?{retiredId:saved.retiredId}:{})};
  await savePost(env,cfg,cat,state);
  return state;
}
async function threadWrite(env:Env,threadId:string,category:Category,old:Current):Promise<void>{
  const t=await api(env,"channels/"+threadId);
  if(t.thread_metadata?.archived){
    if(t.thread_metadata?.locked)throw new Error("Archive thread locked: "+category);
    await api(env,"channels/"+threadId,"PATCH",{archived:false});
  }
  await api(env,"channels/"+threadId+"/messages","POST",{
    content:"📁 **Archiwum: "+LABEL[category]+"**\n"+textFor(category,old),
    allowed_mentions:NO_PINGS,embeds:embedsFor(category,old)
  });
}
async function rollover(env:Env,cfg:BoardConfig,cat:Category,post:Post,fresh:Current|null):Promise<boolean>{
  if(!changed(post.current,fresh)) {
    const displayed=await api(env,"channels/"+cfg.channelId+"/messages/"+post.anchor);
    const wanted=textFor(cat,post.current);
    if(displayed.content!==wanted){
      await api(env,"channels/"+cfg.channelId+"/messages/"+post.anchor,"PATCH",{
        content:wanted,embeds:embedsFor(cat,post.current),allowed_mentions:NO_PINGS
      });
      return true;
    }
    return false;
  }
  const old=post.current;
  if(old){
    // The old item is copied BEFORE the main post is edited. This is how
    // Discord can offer history, since it has no "move message" API.
    const archivedKey=keyFor(cfg,cat)+"_archived_"+encodeURIComponent(old.id).slice(0,300);
    if(await getMeta(env,archivedKey)!=="1"){
      await threadWrite(env,post.thread,cat,old);
      await putMeta(env,archivedKey,"1");
    }
  }
  const next={...post,current:fresh,...(cat==="fashion" && old && !fresh?{retiredId:old.id}:{})};
  await api(env,"channels/"+cfg.channelId+"/messages/"+post.anchor,"PATCH",{
    content:textFor(cat,fresh),embeds:embedsFor(cat,fresh),allowed_mentions:NO_PINGS
  });
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
export async function updateFourPosts(env:Env,cfg:BoardConfig,src:Sources,opts?:{preview?:boolean}):
Promise<{updated:number;changes:string[];errors:string[]}>{
  if(!ID.test(cfg.channelId)||!ID.test(cfg.guildId))throw new Error("Discord news channel not configured");
  const at=Date.now();
  const events=src.events;
  const activeEvent=events===null?undefined:eventCurrent(events,at);
  const expected:Record<Category,Current|null|undefined>={
    event:activeEvent,
    fashion:undefined,
    patch:cfg.lodestone?toCurrent("patch",src.patch,at):undefined,
    dalamud:cfg.dalamud?toCurrent("dalamud",src.dalamud,at):undefined
  };
  const currentList:any=await api(env,"channels/"+cfg.channelId+"/messages?limit=100");
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
          expected.fashion=existing?.expires && existing.expires<=at?null:existing;
        }else{
          const current=toCurrent("fashion",live,at);
          // An old image cached by the source after Tuesday remains expired
          // until a NEW hash is seen, never reactivated automatically.
          expected.fashion=current;
        }
      }else if(post.retiredId===live.id) expected.fashion=null;
      }else if(existing?.expires && existing.expires<=at) expected.fashion=null;
    }
  }
  if(posts.event?.current?.end && posts.event.current.end<=at && events===null) expected.event=null;
  const changes:string[]=[];
  for(const cat of ORDER){
    const post=posts[cat];
    if(!post)continue;
    const fresh=expected[cat];
    if(fresh===undefined)continue; // Failed source: do not clear current news.
    try{
      const edited=await rollover(env,cfg,cat,post,fresh);
      if(edited)changes.push(cat);
    }catch(e:any){errors.push(cat+" update: "+String(e?.message||e));}
  }
  // Only migrate legacy bot-owned category anchors after all four canonical
  // messages exist, leaving anything unrecognized untouched.
  for(const cat of ["fashion","patch","dalamud"] as const)
    if(posts[cat])await oldAnchors(env,cfg,cat,posts[cat]!);
  return {updated:changes.length,changes,errors};
}
