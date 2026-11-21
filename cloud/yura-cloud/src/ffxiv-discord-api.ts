// Shared transport for YURA's FFXIV Discord reads and edits. Discord applies
// rate limits per route and globally; honor its response headers rather than
// treating HTTP 429 as a permanent error or sending immediate retries.
// https://discord.com/developers/docs/topics/rate-limits
type DiscordEnvironment = { DISCORD_BOT_TOKEN?:string };
let serial:Promise<unknown>=Promise.resolve();
let globalBlockedUntil=0;
let nextRequestAt=0;
const routeBlockedUntil=new Map<string,number>();
const REQUEST_GAP_MS=160;
const MAX_TOTAL_WAIT_MS=24000; // Desktop HTTP client has a 28s timeout.
const MAX_ATTEMPTS=4;

const sleep=(milliseconds:number)=>new Promise<void>(resolve=>setTimeout(resolve,milliseconds));
function keyFor(path:string,method:string):string {
  const parts=path.split("?")[0].split("/");
  // The channel/guild snowflake is a Discord "major parameter".
  if(parts[0]==="channels" && parts[1])
    return method+" /channels/"+parts[1]+"/"+(parts[2]||"");
  if(parts[0]==="guilds" && parts[1])
    return method+" /guilds/"+parts[1]+"/"+(parts[2]||"");
  return method+" /"+parts.slice(0,3).join("/");
}
function seconds(value:unknown):number|null {
  const n=Number(value);
  return Number.isFinite(n) && n>=0 && n<=3600 ? n:null;
}
function durationMs(headers:Headers, body?:unknown):number {
  const data=body && typeof body==="object" ? body as Record<string,unknown> : {};
  const n=seconds(data.retry_after) ??
    seconds(headers.get("Retry-After")) ??
    seconds(headers.get("X-RateLimit-Reset-After"));
  return Math.max(150,Math.ceil((n??1)*1000)+175);
}
function timeoutError(method:string,path:string,wait:number):Error {
  return new Error("Discord "+method+" "+path.split("/")[0]+" HTTP 429 (limit, retry za "+
    Math.ceil(wait/1000)+"s)");
}
async function requestInternal(
  token:string,path:string,method:string,body?:unknown
):Promise<any> {
  const route=keyFor(path,method);
  let spent=0;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    const deadline=Math.max(
      nextRequestAt,globalBlockedUntil,routeBlockedUntil.get(route)||0
    );
    const wait=Math.max(0,deadline-Date.now());
    if(spent+wait>MAX_TOTAL_WAIT_MS) throw timeoutError(method,path,wait);
    if(wait){await sleep(wait);spent+=wait;}
    nextRequestAt=Date.now()+REQUEST_GAP_MS;
    const response=await fetch("https://discord.com/api/v10/"+path,{
      method,
      headers:{"authorization":"Bot "+token,"content-type":"application/json",
        "user-agent":"YURA-Cloud-FFXIV/RateLimited"},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const remaining=response.headers.get("X-RateLimit-Remaining");
    const reset=seconds(response.headers.get("X-RateLimit-Reset-After"));
    if(response.status!==429){
      if(remaining==="0"&&reset!==null)
        routeBlockedUntil.set(route,Date.now()+Math.ceil(reset*1000)+175);
      if(!response.ok)
        throw new Error("Discord "+method+" "+path.split("/")[0]+" HTTP "+response.status);
      return response.status===204?null:response.json();
    }
    let payload:unknown;
    try{payload=await response.json();}catch{payload=null;}
    const backoff=durationMs(response.headers,payload);
    const scope=response.headers.get("X-RateLimit-Scope")||"";
    const data=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
    const global=scope==="global"||data.global===true;
    if(global)globalBlockedUntil=Math.max(globalBlockedUntil,Date.now()+backoff);
    else routeBlockedUntil.set(route,Date.now()+backoff);
    if(attempt===MAX_ATTEMPTS-1 || spent+backoff>MAX_TOTAL_WAIT_MS)
      throw timeoutError(method,path,backoff);
  }
  throw timeoutError(method,path,0);
}
export function discordFfxivRequest(
  env:DiscordEnvironment,path:string,method="GET",body?:unknown
):Promise<any>{
  const token=env.DISCORD_BOT_TOKEN?.trim();
  if(!token)return Promise.reject(new Error("DISCORD_BOT_TOKEN missing for FFXIV"));
  // Serialize FFXIV calls in this Worker isolate: overlapping source checks
  // do not exhaust the channel route buckets all at once. No background
  // polling or extra messages are created by this queue.
  const task=serial.then(()=>requestInternal(token,path,method,body));
  serial=task.then(()=>undefined,()=>undefined);
  return task;
}
