import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { authorizedRerun } from './viewer_auth.mjs';
const root=dirname(fileURLToPath(import.meta.url)), solution=resolve(root,'../solution');
const port=Number(process.env.VIEWER_PORT||8811), token=randomBytes(24).toString('hex');
const official=JSON.parse(await readFile(resolve(root,'../data/track_a/claims.json'),'utf8')).claims;
const sceneIds=[...new Set(official.map(c=>c.sceneId))];
const efforts={luna:['none','low','medium','high','xhigh','max'],deepseek:['none','low','high','max']};
let job={state:'idle'}, starting=false;
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
function execute(file,args=[]){return new Promise((ok,fail)=>{const child=spawn(process.execPath,[file,...args],{cwd:solution,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let pending='';child.stdout.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split('\n');pending=lines.pop();for(const line of lines)if(/pass \d+: (complete|FAILED)/.test(line))job.finished++;});
  child.stderr.on('data',()=>{});child.on('error',fail);child.on('close',code=>ok(code));});}
const server=http.createServer(async(req,res)=>{
  let ownsSetup=false;
  try{
    if(!['localhost:'+port,'127.0.0.1:'+port].includes(req.headers.host))return json(res,403,{error:'Invalid host.'});
    const url=new URL(req.url,'http://'+req.headers.host);
    if(url.pathname==='/api/session'&&req.method==='GET')return json(res,200,{token,job});
    if(url.pathname==='/api/status'&&req.method==='GET')return json(res,200,{job});
    if(url.pathname==='/api/rerun'&&req.method==='POST'){
      if(!authorizedRerun(req.headers,token))return json(res,403,{error:'Viewer session expired. Reload the page and try again.'});
      if(starting||job.state==='running')return json(res,409,{error:'A scan is already running.'});
      let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)return json(res,413,{error:'Request too large.'});}
      const p=JSON.parse(body);
      if(!efforts[p.model]?.includes(p.reasoning)||!Number.isInteger(p.passes)||p.passes<1||p.passes>5||!Array.isArray(p.scenes)||!p.scenes.length||p.scenes.length>sceneIds.length||new Set(p.scenes).size!==p.scenes.length||p.scenes.some(id=>!sceneIds.includes(id)))return json(res,400,{error:'Select valid scenes, model, reasoning and 1–5 passes.'});
      // Reserve the runner before asynchronous setup, including simultaneous requests.
      if(starting||job.state==='running')return json(res,409,{error:'A scan is already running.'});
      starting=true;ownsSetup=true;
      const cfg=JSON.parse(await readFile(join(solution,'config.full.json'),'utf8'));
      const id=Date.now().toString();
      cfg.scene_ids=p.scenes;cfg.input_dir=join(root,'assets/views');cfg.output_dir=join(solution,'results','viewer_'+id);cfg.grading_page=false;cfg.request_timeout_seconds=600;
      cfg.models=cfg.models.map(m=>({...m,enabled:m.id===p.model,...(m.id===p.model?{passes:p.passes,reasoning_effort:p.reasoning}:{})}));
      cfg.aggregation.minimum_vote_share=.6;
      await mkdir(join(solution,'.local'),{recursive:true});const configPath=join(solution,'.local','viewer-'+id+'.json');
      await writeFile(configPath,JSON.stringify(cfg));
      job={id,state:'running',model:p.model,finished:0,total:p.scenes.length*p.passes,scenes:p.scenes.length};
      starting=false;ownsSetup=false;
      json(res,202,{job});
      void(async()=>{try{
        const code=await execute(join(solution,'runner.mjs'),['--config',configPath,'--fresh']);
        if(code!==0&&code!==2)throw Error('Scan failed. Check provider access and the runner setup.');
        const report=JSON.parse(await readFile(join(cfg.output_dir,'latest.json'),'utf8'));
        if(report.items.length!==p.scenes.length)throw Error('The scan did not finish every scene.');
        if(await execute(join(root,'model_results.mjs'))!==0)throw Error('Results saved, but the viewer refresh failed.');
        job.errors=report.items.flatMap(i=>i.decisions).filter(d=>d.status==='error').length;
        if(p.model==='deepseek'){
          job.submission=await execute(join(solution,'export_submission.mjs'))===0?'updated':'incomplete';
        }
        job.state='complete';
      }catch(e){job.state='failed';job.message=e.message;}})();return;
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(!/^\/(index\.html|app\.js|data\.js|model-results\.js|styles\.css|assets\/[^\0]+)$/.test(pathname))return json(res,404,{error:'Not found.'});
    const file=resolve(root,'.'+pathname);if(relative(root,file).startsWith('..'))return json(res,403,{error:'Invalid path.'});
    const bytes=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch(e){if(ownsSetup)starting=false;json(res,e.code==='ENOENT'?404:400,{error:e.code==='ENOENT'?'Not found.':'Invalid request.'});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Hackathon viewer: http://localhost:${port}/index.html`));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'The viewer port is already in use. Stop the old static server first.':e.message);process.exitCode=1;});
