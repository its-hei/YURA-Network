// Official Lodestone Topics articles use one hero at
// img.finalfantasyxiv.com/t/<40-character-topic-id>.jpg. Read the article
// instead of guessing a thumbnail, since a side banner may be unrelated.
export function extractOfficialPatchHero(html:string,articleUrl:string):string|null{
  let article:URL;
  try{article=new URL(articleUrl);}catch{return null;}
  if(!["eu.finalfantasyxiv.com","na.finalfantasyxiv.com"].includes(article.hostname))
    return null;
  const id=article.pathname.match(/^\/lodestone\/topics\/detail\/([0-9a-f]{40})\/?$/i)?.[1];
  if(!id)return null;
  const decoded=String(html??"").replace(/&amp;/gi,"&");
  const pattern=new RegExp(
    "(?:(?:https?:)?\\/\\/)?img\\.finalfantasyxiv\\.com\\/t\\/"+id+
    "\\.(?:jpe?g|png|webp)(?:\\?[^\\s\\\"'<>]*)?","i");
  const hit=decoded.match(pattern)?.[0];
  if(!hit)return null;
  const text=hit.startsWith("//")?"https:"+hit:
    /^https?:\/\//i.test(hit)?hit:"https://"+hit;
  try{
    const image=new URL(text);
    if(image.protocol==="https:" && image.hostname==="img.finalfantasyxiv.com" &&
      new RegExp("^/t/"+id+"\\.(?:jpe?g|png|webp)$","i").test(image.pathname))
      return image.toString();
  }catch{}
  return null;
}
