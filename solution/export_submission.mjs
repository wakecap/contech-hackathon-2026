import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {archiveRuns} from './run_history.mjs';
import {buildDataset} from '../demo/model_results.mjs';
const root=dirname(fileURLToPath(import.meta.url));

export function submissionFromDataset(dataset, claims, scenes, team) {
  if(!team?.trim()||team==='TEAM_NAME')throw Error('Set a real team name.');
  const entries=claims.map(c=>{
    const result=dataset.claims.find(row=>row.claimId===c.claimId);
    if(result?.status!=='ok'||!['supported','refuted','no_evidence'].includes(result.verdict))throw Error('Missing complete model output for '+c.claimId);
    const support=(result.models||[]).filter(d=>d.verdict===result.verdict).sort((a,b)=>b.confidence-a.confidence);
    if(!support.length)throw Error('No response for '+c.claimId);
    if(result.verdict!=='no_evidence'&&!support.some(d=>d.views?.length))throw Error('No evidence view for '+c.claimId);
    const evidence=scenes.find(s=>s.sceneId===c.sceneId)?.panoramas;
    if(!evidence?.length)throw Error('Missing scene citation for '+c.claimId);
    return {claimId:c.claimId,verdict:result.verdict,...(result.verdict!=='no_evidence'?{evidence}:{}),rationale:support[0].observation};
  });
  return {team,track_a:entries,track_b:[]};
}

async function main(){
const cfg=JSON.parse(await readFile(join(root,'config.full.json'),'utf8'));
const claims=JSON.parse(await readFile(resolve(root,'../data/track_a/claims.json'),'utf8')).claims;
const scenes=JSON.parse(await readFile(resolve(root,'../data/track_a/scenes.json'),'utf8')).scenes;
const team=process.argv[3]||cfg.team;
const reports=process.argv[2]?[JSON.parse(await readFile(resolve(root,process.argv[2]),'utf8'))]:await archiveRuns(join(root,'results'),join(root,'run_history'));
const sources=reports.filter(r=>r.models?.some(m=>m.id==='deepseek')||r.items.some(i=>i.records.some(rec=>rec.modelId==='deepseek')));
const dataset=buildDataset('deepseek',sources,claims,{run_id:'',grades:{}},cfg.aggregation);
const submission=submissionFromDataset(dataset,claims,scenes,team);
const output=resolve(root,'../submissions',team.replace(/[^a-zA-Z0-9_-]/g,'_'),'submission.json');
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(submission,null,2)+'\n');
console.log(output+' · '+submission.track_a.length+' claims');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
