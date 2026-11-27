import crypto from 'node:crypto';
const clone=x=>JSON.parse(JSON.stringify(x));
export const pairs=a=>Object.fromEntries((a||[]).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
export function mountTargets(h){return new Set([...(h.Mounts||[]).map(m=>m.Target),...(h.Binds||[]).map(b=>{const m=b.match(/:(\/[^:]+)(?::[^:]*)?$/);if(!m)throw Error('Unrecognized retained bind syntax');return m[1]})])}
function bindTarget(b){const m=b.match(/:(\/[^:]+)(?::[^:]*)?$/);if(!m)throw Error('Unrecognized retained bind syntax');return m[1]}
function replaceMounts(h,replace,readonly){h.Binds=(h.Binds||[]).map(b=>{const target=bindTarget(b);if(replace[target])return replace[target]+':'+target+':rw';if(readonly.has(target)){const i=b.lastIndexOf(':'+target);const flags=b.slice(i+target.length+1).replace(/^:/,'').split(',').filter(x=>x&&x!=='ro'&&x!=='rw');return b.slice(0,i)+':'+target+':'+['ro',...flags].join(',')}return b});h.Mounts=(h.Mounts||[]).map(m=>replace[m.Target]?{Type:'volume',Source:replace[m.Target],Target:m.Target,ReadOnly:false}:{...m,ReadOnly:readonly.has(m.Target)?true:m.ReadOnly})}
export function planContainer({old,oldImage,newImage,release,aiVolume,rehearsal=false,volumes={},runtimeEnvironment={},name,project='fracto-ai-release'}){
 if((old.HostConfig.VolumesFrom||[]).length)throw Error('VolumesFrom requires manual runtime review');
 if(old.HostConfig.PublishAllPorts)throw Error('PublishAllPorts requires manual runtime review');
 const h=clone(old.HostConfig);h.AutoRemove=false;h.PublishAllPorts=false;
 const targets=mountTargets(h);
 for(const m of old.Mounts||[])if(!targets.has(m.Destination)){if(m.Type!=='volume'||!m.Name)throw Error('Unspecified bind mount requires runtime review');(h.Mounts??=[]).push({Type:'volume',Source:m.Name,Target:m.Destination,ReadOnly:!m.RW});targets.add(m.Destination)}
 if(targets.has('/var/lib/fracto/ai'))throw Error('An existing AI store requires identity review');
 (h.Binds??=[]).push(aiVolume+':/var/lib/fracto/ai:rw');
 const oldBase=pairs(oldImage.Config.Env),runtime=pairs(old.Config.Env),env={...pairs(newImage.Config.Env)};
 for(const [k,v]of Object.entries(runtime))if(!(k in oldBase)||oldBase[k]!==v)env[k]=v;
 Object.assign(env,runtimeEnvironment);
 Object.assign(env,{FRACTO_AI_ENGINE:'ollama',FRACTO_AI_MODEL:'qwen2.5:7b-instruct-q4_K_M',FRACTO_OLLAMA_URL:'http://host.docker.internal:11434',FRACTO_OLLAMA_ALLOW_HOST_GATEWAY:'true',FRACTO_AI_DATA_DIR:'/var/lib/fracto/ai',FRACTO_AI_LISTEN_HOST:'0.0.0.0',FRACTO_AI_PEER_LISTEN_HOST:'127.0.0.1',FRACTO_AI_PEER_PORT:'3447'});
 for(const [key,value]of Object.entries({SERVER:3001,DATA:3002,ASSET:3003,TILES:3004,ADMIN:3005,UI:3006,AI:3007}))env['FRACTO_'+key+'_PORT']=String(value);
 if(rehearsal){const cache=env.FRACTO_TILE_DATA_DIR||'/var/lib/fracto/tiles';replaceMounts(h,{'/app/logs':volumes.logs,[cache]:volumes.tiles,'/app/servers/fracto-tiles-server/benchmarks':volumes.benchmarks},new Set(['/app/assets','/app/videos',env.FRACTO_TILE_INDEX_DIR||'/var/lib/fracto/index']));env.FRACTO_TILE_CACHE_READ_ONLY='true';h.RestartPolicy={Name:'no',MaximumRetryCount:0};h.PortBindings={};for(let p=3001;p<=3007;p++)h.PortBindings[p+'/tcp']=[{HostIp:'127.0.0.1',HostPort:'0'}]}
 else{h.PortBindings=clone(old.HostConfig.PortBindings||{});h.PortBindings['3007/tcp']=[{HostIp:'127.0.0.1',HostPort:'3007'}]}
 const config=clone(newImage.Config);
 for(const key of ['Cmd','Entrypoint','User','WorkingDir','Healthcheck','StopSignal','StopTimeout'])if(JSON.stringify(old.Config[key])!==JSON.stringify(oldImage.Config[key])&&old.Config[key]!==undefined)config[key]=clone(old.Config[key]);
 const labels=rehearsal?{}:clone(old.Config.Labels||{});labels['fracto.release']=release;labels['fracto.rollout.role']=rehearsal?'rehearsal':'production';
 if(!rehearsal){labels['com.docker.compose.project']=project;delete labels['com.docker.compose.project.config_files'];delete labels['com.docker.compose.project.working_dir'];labels['com.docker.compose.image']=newImage.Id;labels['com.docker.compose.config-hash']=crypto.createHash('sha256').update(JSON.stringify([newImage.Id,env,h])).digest('hex')}
 const body={Image:newImage.Id,Env:Object.entries(env).map(([k,v])=>k+'='+v),Labels:labels,HostConfig:h,ExposedPorts:{...config.ExposedPorts,'3007/tcp':{}},Volumes:config.Volumes};
 for(const key of ['Cmd','Entrypoint','User','WorkingDir','Healthcheck','StopSignal','StopTimeout'])if(config[key]!==undefined)body[key]=config[key];
 for(const key of ['OpenStdin','Tty'])if(old.Config[key]!==undefined)body[key]=old.Config[key];
 const endpoints={};for(const [network,e]of Object.entries(old.NetworkSettings.Networks||{})){const ep={Aliases:rehearsal?[name]:(e.Aliases||[]).filter(x=>x!==old.Id&&x!==old.Id.slice(0,12))};if(!rehearsal&&e.IPAMConfig)ep.IPAMConfig=clone(e.IPAMConfig);endpoints[network]=ep}
 body.NetworkingConfig={EndpointsConfig:endpoints};
 for(const target of Object.keys(newImage.Config.Volumes||{}))if(!mountTargets(h).has(target))throw Error('Candidate image has an unplanned anonymous volume: '+target);
 return body;
}
export function planAIOnlyPreflight(payload){
 const body=clone(payload);
 if(body.Labels?.['fracto.rollout.role']!=='rehearsal'||body.HostConfig.RestartPolicy?.Name!=='no')throw Error('AI preflight must derive from an isolated rehearsal payload');
 body.Labels['fracto.rollout.role']='ai-preflight';
 body.Entrypoint=['/app/docker-entrypoint.sh'];body.Cmd=['node','scripts/launch_service.js','fracto-ai-server'];body.WorkingDir='/app';
 body.HostConfig.PortBindings={'3007/tcp':body.HostConfig.PortBindings['3007/tcp']};
 body.ExposedPorts={'3007/tcp':{}};
 body.Healthcheck={Test:['CMD','node','-e',"fetch('http://127.0.0.1:3007/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],Interval:10000000000,Timeout:5000000000,StartPeriod:30000000000,Retries:3};
 return body;
}
export async function promote(ctx){
 const {api,check,record,payload,oldId,oldName,rehearsalName,productionName,rollbackName,release,state}=ctx;
 const preflightMode=ctx.preflightMode||'full';if(!['full','ai-only'].includes(preflightMode))throw Error('Unknown preflight mode');
 const inspect=id=>api('GET','/containers/'+id+'/json');
 const stop=id=>api('POST','/containers/'+id+'/stop?t=30');
 const rename=(id,name)=>api('POST','/containers/'+id+'/rename?name='+encodeURIComponent(name));
 async function rollback(){
  if(state.production_id){try{await inspect(state.production_id)}catch(e){if(e.status!==404)throw e;state.production_id=null}}
  if(!state.production_id&&state.production_create_requested){try{const found=await inspect(productionName);if(found.Image!==ctx.newImageId||found.Config?.Labels?.['fracto.release']!==release)throw Error('Replacement name belongs to an unexpected container');state.production_id=found.Id}catch(e){if(e.status!==404)throw e}}
  if(state.production_id){const n=await inspect(state.production_id);if(n.Image!==ctx.newImageId)throw Error('Refusing rollback against an unexpected replacement image');if(n.State.Running)await stop(state.production_id);if(n.Name.slice(1)===oldName)await rename(state.production_id,productionName+'-failed')}
  let old=await inspect(oldId);if(old.State.Running&&state.old_stop_requested){await stop(oldId);old=await inspect(oldId)}if(old.Name.slice(1)!==oldName)await rename(oldId,oldName);if(!old.State.Running)await api('POST','/containers/'+oldId+'/start');state.rollback={started:true};await record('waiting_for_old_production');state.rollback.check=await check(oldId,{oldProduction:true});state.rollback.complete=true;state.promoted=false;await record('rolled_back');
 }
 if(ctx.rollbackOnly){if(state.phase==='rolled_back'){const old=await inspect(oldId);if(old.State.Running&&old.Image===ctx.oldImageId&&old.Name.slice(1)===oldName){state.rollback.check=await check(oldId,{oldProduction:true});return state}}await rollback();return state}
 try{
  const original=await inspect(oldId);if(original.Image!==ctx.oldImageId||!original.State.Running)throw Error('Original production identity/state changed');
  state.preflight_mode=preflightMode;await record(preflightMode==='ai-only'?'creating_ai_preflight':'creating_rehearsal');const rehearse=await api('POST','/containers/create?name='+encodeURIComponent(rehearsalName),payload(true,rehearsalName));state.rehearsal_id=rehearse.Id;await record('starting_rehearsal');await api('POST','/containers/'+rehearse.Id+'/start');state.rehearsal_check=await check(rehearse.Id,{generate:true,...(preflightMode==='ai-only'?{aiOnly:true}:{})});
  await stop(rehearse.Id);state.rehearsal_stopped=true;await record('rehearsal_passed');
  const originalAgain=await inspect(oldId);if(originalAgain.Image!==ctx.oldImageId||!originalAgain.State.Running)throw Error('Production drifted during rehearsal');
  state.old_stop_requested=true;await record('stopping_old_production');await stop(oldId);state.old_stopped=true;await ctx.afterOldStopped?.();await record('renaming_old_production');await rename(oldId,rollbackName);state.old_renamed=true;
  state.production_create_requested=true;await record('creating_production');const fresh=await api('POST','/containers/create?name='+encodeURIComponent(productionName),payload(false,productionName));state.production_id=fresh.Id;await record('starting_production');await api('POST','/containers/'+fresh.Id+'/start');state.production_check=await check(fresh.Id,{generate:true,retained:state.rehearsal_check.inference});state.promoted=true;await record('promoted');return state;
 }catch(error){state.error=error.message;if(state.rehearsal_id&&!state.rehearsal_stopped){try{await stop(state.rehearsal_id);state.rehearsal_stopped=true}catch(e){state.rehearsal_stop_error=e.message}}
  if(state.old_stop_requested&&!state.old_stopped){try{const old=await inspect(oldId);state.old_stopped=!old.State.Running}catch(e){state.old_stopped=true}}
  if(state.old_stop_requested){try{await rollback()}catch(e){state.rollback_error=e.message;await record('rollback_requires_attention')}}else await record('aborted_before_cutover');throw error;
 }
}

export function composeSnapshot(payload,{project,name}){
 const h=payload.HostConfig,volumes={},networks={},mounts=[];
 let vi=0,ni=0;
 const normalize=source=>source.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i,(_,d)=>d.toUpperCase()+':/').replace(/^\/host_mnt\/([a-z])\//i,(_,d)=>d.toUpperCase()+':/');
 function add(m){if(!['volume','bind'].includes(m.Type))throw Error('Unsupported snapshot mount');if(m.Type==='volume'){const key='retained_'+vi++;volumes[key]={external:true,name:m.Source};mounts.push({type:'volume',source:key,target:m.Target,read_only:!!m.ReadOnly})}else mounts.push({type:'bind',source:normalize(m.Source),target:m.Target,read_only:!!m.ReadOnly})}
 for(const b of h.Binds||[]){const target=bindTarget(b),index=b.lastIndexOf(':'+target);const source=b.slice(0,index),flags=b.slice(index+target.length+1).replace(/^:/,'').split(',');add({Type:/^(?:[a-z]:|\/|\\)/i.test(source)?'bind':'volume',Source:source,Target:target,ReadOnly:flags.includes('ro')})}
 for(const m of h.Mounts||[])add(m);
 const serviceNetworks={};for(const [actual,endpoint]of Object.entries(payload.NetworkingConfig.EndpointsConfig)){const key='retained_'+ni++;networks[key]={external:true,name:actual};serviceNetworks[key]={aliases:endpoint.Aliases||[]};if(endpoint.IPAMConfig?.IPv4Address)serviceNetworks[key].ipv4_address=endpoint.IPAMConfig.IPv4Address;if(endpoint.IPAMConfig?.IPv6Address)serviceNetworks[key].ipv6_address=endpoint.IPAMConfig.IPv6Address}
 const service={image:payload.Image,container_name:name,environment:pairs(payload.Env),entrypoint:payload.Entrypoint,command:payload.Cmd,working_dir:payload.WorkingDir,user:payload.User,restart:h.RestartPolicy?.Name||'no',volumes:mounts,networks:serviceNetworks,ports:Object.entries(h.PortBindings).flatMap(([port,bindings])=>(bindings||[]).map(b=>({target:Number(port.split('/')[0]),published:b.HostPort,protocol:port.split('/')[1],...(b.HostIp?{host_ip:b.HostIp}:{})}))),stop_grace_period:'30s'};
 if(payload.Healthcheck){const hc=payload.Healthcheck;service.healthcheck=hc.Test?.[0]==='NONE'?{disable:true}:{test:hc.Test,...Object.fromEntries(Object.entries({Interval:'interval',Timeout:'timeout',StartPeriod:'start_period',StartInterval:'start_interval'}).filter(([k])=>hc[k]>0).map(([k,v])=>[v,String(hc[k])+'ns'])),...(hc.Retries?{retries:hc.Retries}:{})}}
 service.labels=Object.fromEntries(Object.entries(payload.Labels||{}).filter(([k])=>!k.startsWith('com.docker.compose.')));
 if(h.LogConfig?.Type)service.logging={driver:h.LogConfig.Type,options:h.LogConfig.Config||{}};
 if(h.ExtraHosts?.length)service.extra_hosts=h.ExtraHosts;if(h.Dns?.length)service.dns=h.Dns;if(h.SecurityOpt?.length)service.security_opt=h.SecurityOpt;if(h.CapAdd?.length)service.cap_add=h.CapAdd;if(h.CapDrop?.length)service.cap_drop=h.CapDrop;if(h.ReadonlyRootfs)service.read_only=true;
 for(const [from,to]of Object.entries({Memory:'mem_limit',MemoryReservation:'mem_reservation',CpuShares:'cpu_shares',PidsLimit:'pids_limit',ShmSize:'shm_size'}))if(h[from]>0)service[to]=h[from];
 return {name:project,services:{fracto:service},volumes,networks};
}
