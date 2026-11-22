import test from "node:test";
import assert from "node:assert/strict";
import {planFcLinkshellPermissions,planFcLinkshellMembers,syncFcLinkshell} from "../src/discord-fc-linkshell.ts";

const gid="1181989574713557082";
const xiv="111111111111111111",fc="222222222222222222",gate="333333333333333333";
const yurabot="444444444444444444",admin="555555555555555555",zira="666666666666666666";
const channelId="777777777777777777";
const u1="888888888888888881",u2="888888888888888882",u3="888888888888888883";
const roles=[
  {id:gid,name:"@everyone",position:0,permissions:"1024"},
  {id:xiv,name:"XIV",position:1,permissions:"0"},
  {id:fc,name:"FC",position:2,permissions:"0"},
  {id:gate,name:"FC XIV",position:3,permissions:"0"},
  {id:zira,name:"Zira",position:4,permissions:"0"},
  {id:admin,name:"Admin",position:8,permissions:"8"},
  {id:yurabot,name:"Y.U.R.A.",position:9,permissions:String(1n<<28n)}
];
const current=[
  {id:gid,type:0,allow:"1024",deny:"0"},
  {id:xiv,type:0,allow:"1024",deny:"0"},
  {id:zira,type:0,allow:"1024",deny:"0"},
  {id:admin,type:0,allow:"1024",deny:"0"},
  {id:yurabot,type:0,allow:"1024",deny:"0"},
  {id:u3,type:1,allow:"1024",deny:"0"}
];
const users=[
  {user:{id:u1,bot:false},roles:[xiv,fc]},
  {user:{id:u2,bot:false},roles:[xiv,gate]},
  {user:{id:u3,bot:false},roles:[fc]}
];
function mockDb(){
  const data=new Map([["discord_onboarding_config_v1",JSON.stringify({guild:gid,fc})]]);
  return {data,DB:{prepare:()=>({bind:(...values)=>({
    first:async()=>({value:data.get(values[0])??""}),
    run:async()=>{data.set(values[0],values[1]);return {meta:{changes:1}};}
  })})}};
}
test("channel override AND gate removes direct XIV/Zira/individual access, preserves admin and YURA",()=>{
  const changes=planFcLinkshellPermissions(current,roles,gid,gate,[yurabot],yurabot);
  const byId=new Map(changes.map(x=>[x.id,x]));
  assert.equal(byId.get(gid).deny,"1024");
  assert.equal(byId.get(gid).allow,"0");
  assert.equal(byId.get(gate).allow,"1024");
  assert.equal(byId.get(xiv).allow,"0");
  assert.equal(byId.get(zira).allow,"0");
  assert.equal(byId.get(u3).allow,"0");
  assert.equal(byId.has(admin),false);
  assert.equal(byId.has(yurabot),false);
});
test("role membership uses intersection and removes obsolete technical role",()=>{
  assert.deepEqual(planFcLinkshellMembers(users,xiv,fc,gate),{
    eligible:1,grant:[u1],revoke:[u2]
  });
});
test("one cron reconciliation repairs channel overrides and assigns only matching members",async()=>{
  const old=globalThis.fetch;
  const writes=[];
  const {DB,data}=mockDb();
  globalThis.fetch=async(url,opts)=>{
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    const query=new URL(String(url)).search;
    const method=opts?.method??"GET";
    if(method==="GET"){
      let body;
      if(path==="guilds/"+gid+"/roles")body=roles;
      else if(path==="guilds/"+gid+"/channels")body=[{id:channelId,guild_id:gid,type:0,name:"fc-linkshell"}];
      else if(path==="users/@me")body={id:yurabot};
      else if(path==="channels/"+channelId)body={id:channelId,guild_id:gid,permission_overwrites:current};
      else if(path==="guilds/"+gid+"/members/"+yurabot)body={user:{id:yurabot,bot:true},roles:[yurabot]};
      else if(path==="guilds/"+gid+"/members"&&query==="?limit=1000")body=[...users,{user:{id:yurabot,bot:true},roles:[yurabot]}];
      else if(path.startsWith("guilds/"+gid+"/members/"))body=users.find(x=>x.user.id===path.split("/")[3]);
      if(body===undefined)throw Error("Unexpected "+method+" "+path+query);
      return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
    }
    writes.push({path,method,body:opts?.body?JSON.parse(opts.body):null});
    return new Response(null,{status:204});
  };
  try{
    const status=await syncFcLinkshell({DB,DISCORD_BOT_TOKEN:"test"});
    assert.equal(status.status,"ready");
    assert.equal(status.eligible,1);
    assert.equal(status.added,1);
    assert.equal(status.removed,1);
    assert.ok(status.permission_changes>=5);
    assert.ok(writes.some(w=>w.path==="guilds/"+gid+"/members/"+u1+"/roles/"+gate&&w.method==="PUT"));
    assert.ok(writes.some(w=>w.path==="guilds/"+gid+"/members/"+u2+"/roles/"+gate&&w.method==="DELETE"));
    assert.ok(writes.filter(w=>w.path.startsWith("channels/")).every(w=>w.method==="PUT"));
    assert.ok(writes.find(w=>w.path==="channels/"+channelId+"/permissions/"+gate)?.body.allow==="1024");
    assert.equal(JSON.parse(data.get("discord_fc_linkshell_last_sync_v1")).status,"ready");
  }finally{globalThis.fetch=old;}
});
test("duplicates or incomplete Discord membership never cause permission writes",async()=>{
  const old=globalThis.fetch;
  const {DB,data}=mockDb();
  let writes=0;
  globalThis.fetch=async(url,opts)=>{
    const path=new URL(String(url)).pathname.replace("/api/v10/","");
    if(opts?.method!=="GET"){writes++;return new Response(null,{status:204});}
    const body=path==="guilds/"+gid+"/roles"?[...roles,{...roles[1],id:"999999999999999999"}]:
      path==="guilds/"+gid+"/channels"?[{id:channelId,guild_id:gid,type:0,name:"fc-linkshell"}]:
      path==="users/@me"?{id:yurabot}:null;
    return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    await assert.rejects(syncFcLinkshell({DB,DISCORD_BOT_TOKEN:"test"}),/exactly one Discord role/);
    assert.equal(writes,0);
    assert.equal(JSON.parse(data.get("discord_fc_linkshell_last_sync_v1")).status,"error");
  }finally{globalThis.fetch=old;}
});
