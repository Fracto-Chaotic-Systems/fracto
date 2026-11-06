import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const ROOT=path.resolve(import.meta.dirname,'..');
export function managed_production_plan({root=ROOT,action='status'}={}){
 if(!['upgrade','start','stop','status','is-running','logs','rollback'].includes(action))throw Error('Unknown managed production action');
 const registry=JSON.parse(fs.readFileSync(path.join(root,'.fracto-production.json'),'utf8'));if(registry.schema_version!==1)throw Error('Unsupported managed production registration');
 const controller=path.join(root,'.fracto-managed','manage-production.mjs');if(!fs.statSync(controller).isFile())throw Error('Managed controller is missing');
 return {args:[controller,action],options:{cwd:root,stdio:'inherit',shell:false,windowsHide:true}};
}
export function run_managed_production({root=ROOT,action='status',run=spawnSync}={}){const plan=managed_production_plan({root,action});const result=run(process.execPath,plan.args,plan.options);if(result.error)throw result.error;return result.status??1}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){try{if(process.argv.length>3)throw Error('Expected one managed production action');process.exitCode=run_managed_production({action:process.argv[2]||'status'})}catch(e){console.error(e.message);process.exitCode=2}}
