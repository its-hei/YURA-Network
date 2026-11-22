// Official in-game, limited-time FFXIV events, discovered from Lodestone Topics.
// Never infer availability from a marketing post without verified GMT start/end.
export type EventTopic = { title:string; url:string; date:number };
export type LiveEvent = EventTopic & { start:number; end:number; image?:string };

const MONTH_INDEX:Record<string,number> = {
  january:0,february:1,march:2,april:3,may:4,june:5,
  july:6,august:7,september:8,october:9,november:10,december:11
};
const DATE_GMT = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(?:\(GMT\)|GMT|\(UTC\)|UTC)(?![A-Za-z0-9])/gi;

function cleanPage(html:string):string {
  // HTML is untrusted content. Extract text only, never render source HTML.
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi," ")
    .replace(/<[^>]*>/g," ")
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/\s+/g," ").trim();
}
function parseGmtDate(m:RegExpMatchArray):number {
  const day=Number(m[1]), month=MONTH_INDEX[m[2].toLowerCase()], year=Number(m[3]);
  const hour=Number(m[4]),minute=Number(m[5]);
  const ms=Date.UTC(year,month,day,hour,minute);
  const d=new Date(ms);
  if (d.getUTCDate()!==day || d.getUTCMonth()!==month || d.getUTCFullYear()!==year ||
    hour>23 || minute>59) return NaN;
  return ms;
}
export function eligibleEventTitle(title:string):boolean {
  // In-game quest / seasonal / crossover events, not fan festivals,
  // stage shows, store discounts or ranking seasons.
  if (/fan festival|concert|merchandise|optional item|livestream|live stream|esports|sale|recruitment|ranking|producer live|ticket/i.test(title))
    return false;
  return /(?:crossover|collaboration|seasonal)\s+event|event\s+(?:returns|begins|starts|arrives)|(?:starlight celebration|heavensturn|hatching.tide|moonfire faire|the rising|all saints. wake|valentione|little ladies. day|make it rain campaign|the path infernal)/i.test(title);
}
export function parseOfficialEventPage(html:string):{start:number;end:number;image?:string}|null {
  const text=cleanPage(html);
  // Event dates must be in the official article "Event Schedule"/"Event Period"
  // section. Other dates elsewhere on the page must never count.
  const p=/\bEvent (?:Schedule|Period|Dates)\b/i.exec(text);
  if(!p) return null;
  const window=text.slice(p.index,p.index+1400);
  const found=[...window.matchAll(DATE_GMT)].slice(0,2);
  if(found.length<2) return null;
  const [start,end]=found.map(parseGmtDate);
  if(!Number.isFinite(start)||!Number.isFinite(end) || end<=start ||
     end-start>75*86400000) return null;

  let image: string|undefined;
  // Use artwork only from known official Square Enix/CDN hosts.
  const tags=[...html.matchAll(/<meta\b[^>]*>/gi)].map(x=>x[0]);
  const cover=tags.find(x=>/\b(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["']/i.test(x));
  const value=cover?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  if(value) {
    try {
      const uri=new URL(value.replace(/&amp;/g,"&"));
      if(uri.protocol==="https:" &&
         /^(?:lds-img|img)\.finalfantasyxiv\.com$/i.test(uri.hostname))
        image=uri.toString();
    } catch {/* Ignore invalid cover images. */}
  }
  return {start,end,...(image?{image}:{})};
}
export async function discoverLiveEvents(
  topics:EventTopic[],
  getPage:(url:string)=>Promise<string>,
  at=Date.now()
):Promise<{events:LiveEvent[];errors:string[]}> {
  const candidates=topics
    .filter(x=>eligibleEventTitle(x.title) &&
      /^https:\/\/(?:eu|na)\.finalfantasyxiv\.com\/lodestone\/topics\/detail\/[a-f0-9]+\/?$/i.test(x.url) &&
      x.date<=at+86400000 && x.date>=at-90*86400000)
    .sort((a,b)=>b.date-a.date)
    .slice(0,18); // bounded daily source reads, enough for overlapping events
  const events:LiveEvent[]=[];
  const errors:string[]=[];
  for(const topic of candidates) {
    try {
      const parsed=parseOfficialEventPage(await getPage(topic.url));
      if (!parsed) continue; // No trustworthy scheduled end => do not claim active.
      if(parsed.start<=at && at<parsed.end) {
        events.push({...topic,...parsed});
      }
    } catch(e:any) {errors.push(topic.url+": "+String(e?.message||e).slice(0,120));}
  }
  // A verified Square Enix special page is a secondary official source:
  // some announcements may roll off the Topics feed while the event remains
  // active. This one bounded 2026 crossover fallback is NOT a hard-coded
  // "active" status: the date range is parsed from the live official page.
  if (!events.some(e=>/FFXVI|The Path Infernal|Final Fantasy\s*XVI/i.test(e.title)||e.url.includes("/ffxvi/")) &&
      at>=Date.UTC(2026,10,18) && at<Date.UTC(2026,11,10)) {
    const official="https://eu.finalfantasyxiv.com/lodestone/special/ffxvi/e86ytg2ko3";
    try {
      const parsed=parseOfficialEventPage(await getPage(official));
      if (parsed && parsed.start<=at && at<parsed.end)
        events.push({
          title:"The Path Infernal — FFXIV × FFXVI",
          url:official,date:parsed.start,...parsed
        });
    } catch(e:any) {errors.push("official event site: "+String(e?.message||e).slice(0,120));}
  }
  return {events:events.sort((a,b)=>a.end-b.end||a.url.localeCompare(b.url)),errors};
}
