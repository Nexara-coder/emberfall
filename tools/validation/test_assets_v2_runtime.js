const fs=require('fs'), path=require('path'), vm=require('vm');
const THREE=require('../../js/vendor/three.min.js');
global.window=global; global.THREE=THREE;
THREE.TextureLoader.prototype.load=function(u){ const t=new THREE.Texture(); t.name=u; return t; };
global.fetch=async function(u){
  let rel=String(u).split('?')[0];
  if(rel.startsWith('api/index.php')){
    const m=String(u).match(/[?&]f=([^&]+)/); if(!m) return {ok:false,status:404};
    rel='assets/'+decodeURIComponent(m[1]);
  }
  const f=path.resolve(process.cwd(),rel);
  try{const b=fs.readFileSync(f); return {ok:true,status:200,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}
  catch(e){return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)};}
};
function run(f){vm.runInThisContext(fs.readFileSync(f,'utf8'),{filename:f});}
run('js/glb.js'); run('js/assets.js'); run('js/textures.js'); run('js/models.js');
(async()=>{
  const result=await RFAssets.loadAll();
  const expected=['tree_oak','tree_willow','tree_pine','tree_dead','well','fence_section','signpost','barrel','sword','axe','pickaxe','shield','house_timber','adventurer_base'];
  const missing=expected.filter(k=>!RFAssets.hasV2(k));
  const sword=RFModels.weaponModel('sword','#fff','#777');
  const axe=RFModels.weaponModel('hatchet','#fff','#777');
  const pick=RFModels.weaponModel('pickaxe','#fff','#777');
  const shield=RFModels.shieldModel('#fff','#777');
  const house=RFModels.building({name:'Test cottage',style:'timber',w:8,d:7,door:[0,0],interior:[]});
  let houseAuth=false; house.traverse(o=>{if(o.userData&&o.userData.authoredV2==='house_timber') houseAuth=true;});
  const checks={
    loadResult:result,
    v2Expected:expected.length,
    v2Missing:missing,
    swordAuth:sword.userData.authoredV2||null,
    axeAuth:axe.userData.authoredV2||null,
    pickaxeAuth:pick.userData.authoredV2||null,
    shieldAuth:shield.userData.authoredV2||null,
    timberHouseAuthored:houseAuth,
    maleRig:!!RFAssets.rigged('male'),
    femaleRig:!!RFAssets.rigged('female')
  };
  fs.writeFileSync('tools/validation/assets_v2_runtime.json',JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks,null,2));
  if(missing.length||checks.swordAuth!=='sword'||checks.axeAuth!=='axe'||checks.pickaxeAuth!=='pickaxe'||checks.shieldAuth!=='shield'||!houseAuth||!checks.maleRig||!checks.femaleRig) process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
