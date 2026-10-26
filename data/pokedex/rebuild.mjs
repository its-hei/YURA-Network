// Y.U.R.A. Pokédex — editable generation CSV -> catalog.csv + catalog.json.
// Node 20+. Source of truth: the nine gen-*.csv files next to this script.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here=dirname(fileURLToPath(import.meta.url));
const sheets=[
  ["gen-1-kanto.csv",1,1,151],["gen-2-johto.csv",2,152,251],
  ["gen-3-hoenn.csv",3,252,386],["gen-4-sinnoh.csv",4,387,493],
  ["gen-5-unova.csv",5,494,649],["gen-6-kalos.csv",6,650,721],
  ["gen-7-alola.csv",7,722,809],["gen-8-galar-hisui.csv",8,810,905],
  ["gen-9-paldea.csv",9,906,1025]
];
const header=["Numer","Nazwa","Identyfikator","Generacja","Region","Kategoria","Losowanie","Waga","Notatki"];
function parseCsv(content){
  const rows=[];let row=[],cell="",quoted=false;
  content=content.replace(/^\uFEFF/,"");
  for(let i=0;i<content.length;i++){
    const char=content[i];
    if(quoted){
      if(char==='"'&&content[i+1]==='"'){cell+='"';i++;}
      else if(char==='"')quoted=false;
      else cell+=char;
    }else if(char==='"'&&cell===""){quoted=true;}
    else if(char===';'){row.push(cell);cell="";}
    else if(char==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
    else cell+=char;
  }
  if(quoted)throw Error("Niezamknięty cudzysłów w CSV");
  if(cell!==""||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function encodeCell(x){
  const v=String(x??"");
  return /[;"\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;
}
const lines=[header.join(";")];const items=[];
const seen=new Set();
for(const [name,gen,min,max] of sheets){
  const rows=parseCsv(readFileSync(join(here,name),"utf8"));
  if(JSON.stringify(rows[0])!==JSON.stringify(header))throw Error("Nieprawidłowe nagłówki: "+name);
  if(rows.length-1!==max-min+1)throw Error("Zła liczba Pokémonów w "+name);
  for(const row of rows.slice(1)){
    if(row.length!==header.length)throw Error("Zła liczba kolumn w "+name+": "+row.join(" "));
    const id=Number(row[0]);const genFromCsv=Number(row[3].replace("GEN ",""));
    if(!Number.isInteger(id)||id<min||id>max||genFromCsv!==gen||seen.has(id))
      throw Error("Niewłaściwy numer / generacja / duplikat: "+name+" #"+id);
    seen.add(id);
    const [number,displayName,slug,_generation,region,category,choice,weightStr,notes]=row;
    if(!displayName.trim()||!/^[a-z0-9-]+$/.test(slug))throw Error("Brak nazwy lub slug: #"+id);
    if(!["Zwykły","Legendarny","Mityczny"].includes(category))throw Error("Zła kategoria: #"+id);
    if(!["TAK","NIE"].includes(choice))throw Error("Losowanie powinno mieć TAK/NIE: #"+id);
    const weight=Number(weightStr);
    if(!Number.isInteger(weight)||weight<1||weight>100)
      throw Error("Waga musi wynosić 1–100: #"+id);
    const pokemon={
      id,name:displayName,slug,generation:gen,region,category,
      enabled:choice==="TAK",rollWeight:weight,notes
    };
    items.push(pokemon);
    lines.push([String(id).padStart(4,"0"),displayName,slug,"GEN "+gen,region,category,choice,weight,notes].map(encodeCell).join(";"));
  }
}
items.sort((a,b)=>a.id-b.id);
if(items.length!==1025||items.some((x,i)=>x.id!==i+1))throw Error("Pokédex niekompletny");
lines.splice(1,items.length,...items.map(x=>[String(x.id).padStart(4,"0"),x.name,x.slug,
  "GEN "+x.generation,x.region,x.category,x.enabled?"TAK":"NIE",x.rollWeight,x.notes].map(encodeCell).join(";")));
writeFileSync(join(here,"catalog.csv"),"\uFEFF"+lines.join("\r\n")+"\r\n","utf8");
writeFileSync(join(here,"catalog.json"),JSON.stringify({
  schemaVersion:1,generatedAt:new Date().toISOString(),
  source:"https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv",
  speciesCount:1025,
  scope:"National Pokédex species only; forms do not have separate species IDs",
  items
},null,2)+"\n","utf8");
console.log("Zaktualizowano catalog.csv i catalog.json: 1025 Pokémonów / 9 generacji");
