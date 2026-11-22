import test from "node:test";
import assert from "node:assert/strict";
import {validateAutoRules,planAutoRoleChanges} from "../src/discord-auto-roles.ts";
const guild="1181989574713557082",bot="111111111111111111";
const a="222222222222222222",b="333333333333333333",target="444444444444444444";
const roles=[
  {id:guild,name:"@everyone",position:0,permissions:"0"},
  {id:a,name:"A",position:1,permissions:"0"},
  {id:b,name:"B",position:2,permissions:"0"},
  {id:target,name:"Target",position:3,permissions:"0"},
  {id:bot,name:"Bot",position:9,permissions:String(1n<<28n)}
];
const rule={id:"auto-test-rule1",name:"Custom",required_role_ids:[a,b],target_role_id:target,enabled:true};
test("validate custom AND-gated role and reserved targets",()=>{
  assert.deepEqual(validateAutoRules([rule],roles,[bot],guild),[rule]);
  assert.throws(()=>validateAutoRules([{...rule,required_role_ids:[a,a]}],roles,[bot],guild),/distinct/);
  assert.throws(()=>validateAutoRules([{...rule,target_role_id:a}],roles,[bot],guild),/Target/);
  assert.throws(()=>validateAutoRules([rule,rule],roles,[bot],guild),/duplicated/);
  assert.throws(()=>validateAutoRules([{...rule,target_role_id:bot}],roles,[bot],guild),/safely/);
});
test("grant only on both roles; remove if one is missing",()=>{
  const data=[
    {user:{id:"555555555555555551"},roles:[a,b]},
    {user:{id:"555555555555555552"},roles:[a]},
    {user:{id:"555555555555555553"},roles:[b,target]},
    {user:{id:"555555555555555554",bot:true},roles:[a,b]}
  ];
  const p=planAutoRoleChanges(data,[rule]);
  assert.equal(p.eligible,1);
  assert.deepEqual(p.add.map(x=>x.user),["555555555555555551"]);
  assert.deepEqual(p.remove.map(x=>x.user),["555555555555555553"]);
  assert.equal(planAutoRoleChanges(data,[{...rule,enabled:false}]).add.length,0);
});
test("never plan destructive changes on a partial member response",()=>{
  assert.throws(()=>planAutoRoleChanges([{user:{id:"555555555555555551"}}],[rule]),/incomplete/);
});
