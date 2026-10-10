import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { aggregate, validateDecisions } from '../voting.mjs';
import { prepareImage } from '../images.mjs';
import { runBatch, buildJobs, validateConfig, jobViews } from '../runner.mjs';
import { inspect, consumeResponseStream, parseDecisionJSON } from '../providers.mjs';
import { SubscriptionAuth } from '../auth.mjs';
import { archiveRuns, runTime } from '../run_history.mjs';
import { buildDataset } from '../../demo/model_results.mjs';
import { submissionFromDataset } from '../export_submission.mjs';

const claim = { claimId: 'c', statement: 'A window is depicted.' };
const decision = (verdict, confidence = .8) => ({ claimId: 'c', verdict, confidence, observation: 'Visible test evidence.', views: ['image'], limitation: '' });
const record = (modelId, pass, verdict, confidence) => ({ modelId, model: modelId, pass, decisions: [decision(verdict, confidence)] });
const policy = { minimum_winner_share: .6, minimum_margin: .15 };

test('submission follows latest partial reruns and uses original scene citations', () => {
  const claims=[{...claim,sceneId:'scene'},{...claim,claimId:'d',sceneId:'scene2'}];
  const make=(id,rows)=>({run_id:id,models:[{id:'deepseek',passes:1}],items:[{records:[{modelId:'deepseek',pass:1,decisions:rows}],decisions:rows,images:['preview.jpg']}]});
  const old=make('old',[decision('supported'),{...decision('no_evidence'),claimId:'d'}]);
  const newer=make('new',[decision('refuted',.3)]);
  const dataset=buildDataset('deepseek',[newer,old],claims,{run_id:'',grades:{}},{...policy,minimum_winner_points:60});
  const scenes=[{sceneId:'scene',panoramas:['site/scene/color.png']},{sceneId:'scene2',panoramas:['site/scene2/color.png']}];
  const submission=submissionFromDataset(dataset,claims,scenes,'Team 4');
  assert.equal(submission.track_a[0].verdict,'refuted');
  assert.deepEqual(submission.track_a[0].evidence,['site/scene/color.png']);
  assert.equal(submission.track_a[1].verdict,'no_evidence');
  assert.ok(!('evidence' in submission.track_a[1]));
  assert.equal(dataset.claims[0].low_confidence,true);
  assert.deepEqual(submission.track_b,[]);
  const incomplete=buildDataset('deepseek',[newer],claims,{run_id:'',grades:{}},policy);
  assert.throws(()=>submissionFromDataset(incomplete,claims,scenes,'Team 4'),/Missing complete/);
  const failed=make('failed',[]);failed.items[0].decisions=[{claimId:'c'}];
  const errors=buildDataset('deepseek',[failed,old],claims,{run_id:'',grades:{}},policy);
  assert.throws(()=>submissionFromDataset(errors,claims,scenes,'Team 4'),/Missing complete/);
});

test('saved runs remain isolated while current results combine latest per claim', () => {
  const c1={claimId:'c',sceneId:'scene',statement:'One'},c2={claimId:'d',sceneId:'scene2',statement:'Two'};
  const make=(id,effort,rows)=>({run_id:id,models:[{id:'deepseek',passes:1,reasoning_effort:effort}],aggregation:policy,items:[{records:[{modelId:'deepseek',pass:1,decisions:rows}],decisions:rows,images:['scene/color.png']}]});
  const old=make('2026-10-10T09-00-00.000Z','low',[decision('supported'),{...decision('refuted'),claimId:'d'}]);
  const newer=make('2026-10-10T10-00-00.000Z','high',[decision('refuted')]);
  const reference={run_id:'ref',grades:{c:{truth:'supported'},d:{truth:'refuted'}}};
  const current=buildDataset('deepseek',[newer,old],[c1,c2],reference,policy);
  const snapshot=buildDataset('deepseek',[newer],[c1,c2],reference,policy);
  assert.equal(current.claims[0].verdict,'refuted');assert.equal(current.claims[1].verdict,'refuted');
  assert.equal(current.reasoning_level,'mixed');assert.equal(snapshot.reasoning_level,'high');
  assert.equal(snapshot.claims[1].status,'pending');assert.equal(Object.keys(snapshot.grading.grades).length,1);
  assert.ok(runTime(newer.run_id)>runTime(old.run_id));
});

test('history deduplicates latest/timestamp reports and survives latest replacement', async () => {
  const dir=await mkdtemp(join(tmpdir(),'prove-it-history-')),results=join(dir,'results'),history=join(dir,'history');
  await mkdir(join(results,'batch'),{recursive:true});
  try {
    const old={run_id:'2026-10-10T09-00-00.000Z',items:[{id:'old'}]},next={run_id:'2026-10-10T10-00-00.000Z',items:[{id:'new'}]};
    await writeFile(join(results,'batch','latest.json'),JSON.stringify(old));
    await writeFile(join(results,'batch',old.run_id+'.json'),JSON.stringify(old));
    assert.equal((await archiveRuns(results,history)).length,1);
    await writeFile(join(results,'batch','latest.json'),JSON.stringify(next));
    const saved=await archiveRuns(results,history);assert.deepEqual(saved.map(r=>r.run_id),[next.run_id,old.run_id]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a confident minority cannot pass the optional vote-consistency gate', () => {
  const models=[{id:'a',passes:3,weight:1}];
  const rows=[record('a',1,'supported',.99),record('a',2,'refuted',.2),record('a',3,'refuted',.2)];
  const result=aggregate('c',models,rows,{...policy,minimum_vote_share:.6});
  assert.equal(result.leading_verdict,'supported');assert.equal(result.vote_share,1/3);
  assert.equal(result.status,'needs_review');
  assert.equal(aggregate('c',models,[rows[0],rows[0],rows[2]],policy).status,'error');
});

test('submission policy emits the strongest legal answer at low confidence without hiding failures', () => {
  const models=[{id:'a',passes:1,weight:1}];
  const p={...policy,minimum_winner_points:60,accept_low_confidence:true};
  const result=aggregate('c',models,[record('a',1,'refuted',.3)],p);
  assert.equal(result.status,'ok');assert.equal(result.verdict,'refuted');assert.equal(result.low_confidence,true);
  assert.equal(aggregate('c',models,[],p).status,'error');
});

test('DeepSeek reasoning settings reach the SDK request', async () => {
  const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test-placeholder';
  try {
    for(const effort of ['none','low','high','max']) {
      let body;
      await inspect({id:'deepseek',provider:'deepseek',model:'deepseek-flash',reasoning_effort:effort},[claim],[{name:'image',url:'data:image/png;base64,test'}],1,{request_timeout_seconds:10},null,()=>({chat:{completions:{create:async value=>{body=value;return {model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:[decision('supported')]})}}]};}}}}));
      assert.equal(body.thinking.type,effort==='none'?'disabled':'enabled');
      assert.equal(body.reasoning_effort,effort==='none'?undefined:effort);
    }
  } finally { if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old; }
});

test('recovers streamed text when completed event omits its message body', async () => {
  const text = JSON.stringify({ decisions: [decision('supported')] });
  const stream = (async function* () {
    yield { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: text.slice(0, 30) };
    yield { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: text.slice(30) };
    yield { type: 'response.output_text.done', output_index: 1, content_index: 0, text };
    yield { type: 'response.completed', response: { output: [] } };
  })();
  const result = await consumeResponseStream(stream);
  assert.equal(result.text, text); assert.equal(result.text_source, 'done');
});
test('accepts only valid plain or single fenced JSON and explains empty output', () => {
  assert.deepEqual(parseDecisionJSON('```json\n{"decisions":[]}\n```'), { decisions: [] });
  assert.throws(() => parseDecisionJSON(''), /no answer text/);
  assert.throws(() => parseDecisionJSON('prefix {"decisions":[]}'), /invalid JSON/);
  assert.throws(() => parseDecisionJSON('{"decisions":['), /invalid JSON/);
});

test('normalizes passes per model and uses confidence points', () => {
  const models = [{ id: 'a', passes: 3, weight: 1 }, { id: 'b', passes: 1, weight: 1 }];
  const result = aggregate('c', models, [record('a', 1, 'supported', .8), record('a', 2, 'supported', .8),
    record('a', 3, 'supported', .8), record('b', 1, 'refuted', .8)], policy);
  assert.equal(result.scores.supported, 40);
  assert.equal(result.scores.refuted, 40);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.verdict, null);
});
test('failed passes remain errors, never no_evidence', () => {
  const result = aggregate('c', [{ id: 'a', passes: 2, weight: 1 }], [record('a', 1, 'supported', .9)], policy);
  assert.equal(result.status, 'error'); assert.equal(result.verdict, null);
});
test('a unanimous but low-confidence answer still needs review', () => {
  const result = aggregate('c', [{ id: 'a', passes: 1, weight: 1 }], [record('a', 1, 'supported', .1)],
    { ...policy, minimum_winner_points: 60 });
  assert.equal(result.winner_share, 1); assert.equal(result.status, 'needs_review');
});
test('subscription requests require terminal completion and supply images and schema', async () => {
  const model = { id: 'luna', provider: 'openai', model: 'gpt-6-luna', auth: 'subscription' };
  const config = { request_timeout_seconds: 5 };
  let captured;
  const factory = options => {
    assert.equal(options.apiKey, 'fake-oauth-for-test');
    return { responses: { create: async request => {
      captured = request;
      return (async function* () { yield { type: 'response.completed', response: {
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ decisions: [decision('supported')] }) }] }], usage: { input_tokens: 123 }
      } }; })();
    } } };
  };
  const auth = { accessToken: async () => 'fake-oauth-for-test' };
  const result = await inspect(model, [claim], [{ name: 'image', url: 'data:image/png;base64,test' }], 1, config, auth, factory);
  assert.equal(captured.store, false); assert.equal(captured.stream, true);
  assert.equal(captured.model, 'gpt-6-luna'); assert.equal(captured.text.format.strict, true);
  assert.equal(captured.input[0].content[2].type, 'input_image');
  assert.equal(result.usage.input_tokens, 123);
  const incomplete = () => ({ responses: { create: async () => (async function* () {
    yield { type: 'response.output_text.delta', delta: '{}' };
  })() } });
  await assert.rejects(inspect(model, [claim], [{ name: 'image', url: 'test' }], 1, config, auth, incomplete), /without completed/);
  const failed = () => ({ responses: { create: async () => (async function* () {
    yield { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } };
  })() } });
  await assert.rejects(inspect(model, [claim], [{ name: 'image', url: 'test' }], 1, config, auth, failed), /usage_limit_exceeded/);
});
test('Windows credentials are encrypted and persist without reading Codex auth', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prove-it-auth-'));
  try {
    const auth = await new SubscriptionAuth(dir).load();
    auth.state.profiles.push({ client_id: 'test', access_token: 'fake-secret-for-test-only' });
    auth.state.active = 'test'; await auth.save();
    const disk = await readFile(join(dir, 'chatgpt.dpapi'), 'utf8');
    assert.ok(!disk.includes('fake-secret-for-test-only'));
    const again = await new SubscriptionAuth(dir).load();
    assert.equal(again.state.hostId, auth.state.hostId);
    assert.equal(again.profile().access_token, 'fake-secret-for-test-only');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('validates evidence, confidence, and duplicate IDs', () => {
  assert.throws(() => validateDecisions({ decisions: [{ ...decision('supported'), views: [] }] }, [claim], ['image']));
  assert.throws(() => validateDecisions({ decisions: [decision('supported', 2)] }, [claim], ['image']));
  assert.throws(() => validateDecisions({ decisions: [{ ...decision('supported'), views: ['invented'] }] }, [claim], ['image']));
  assert.throws(() => validateDecisions({ decisions: [decision('supported'), decision('supported')] }, [claim], ['image']));
  assert.equal(validateDecisions({ decisions: [decision('no_evidence')] }, [claim], ['image']).length, 1);
});
test('equirectangular faces have correct central directions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prove-it-tiles-'));
  try {
    const width = 400, height = 200, raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      raw[(y * width + x) * 3] = Math.round(x / width * 255);
      raw[(y * width + x) * 3 + 1] = Math.round(y / height * 255);
    }
    const file = join(dir, 'pano.png');
    await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(file);
    const views = await prepareImage(file, { image_projection: 'equirectangular', face_size: 3 });
    const center = {};
    for (const view of views) {
      const pixels = await sharp(Buffer.from(view.url.split(',')[1], 'base64')).raw().toBuffer();
      center[view.name] = [...pixels.subarray(12, 15)];
    }
    assert.ok(Math.abs(center.front[0] - 127) < 3);
    assert.ok(Math.abs(center.right[0] - 191) < 3);
    assert.ok(Math.abs(center.left[0] - 63) < 3);
    assert.ok(center.up[1] < 3); assert.ok(center.down[1] > 250);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('wide panorama crops preserve original geometry and cover the full width', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prove-it-strip-'));
  try {
    const file = join(dir, 'wide.png');
    await sharp({ create: { width: 3072, height: 854, channels: 3, background: 'blue' } }).png().toFile(file);
    const views = await prepareImage(file, { image_projection: 'panorama_strip', max_image_edge: 2048 });
    assert.deepEqual(views.map(v => v.name), ['overview', 'crop_x0_to_1024', 'crop_x768_to_1792', 'crop_x1536_to_2560', 'crop_x2048_to_3072']);
    for (const view of views.slice(1)) {
      const info = await sharp(Buffer.from(view.url.split(',')[1], 'base64')).metadata();
      assert.equal(info.width, 1024); assert.equal(info.height, 854);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('seam crop concatenates the original right and left edges without warping', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prove-it-seam-'));
  try {
    const width = 300, height = 80, data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      data[(y * width + x) * 3] = x < 50 ? 255 : 0;
      data[(y * width + x) * 3 + 2] = x >= 250 ? 255 : 0;
    }
    const file = join(dir, 'pano.png');
    await sharp(data, { raw: { width, height, channels: 3 } }).png().toFile(file);
    const views = await prepareImage(file, { image_projection: 'panorama_strip', max_image_edge: 2048,
      crop_width: 100, crop_overlap: .25, include_seam_crop: true });
    const seam = views.at(-1);
    assert.equal(seam.name, 'seam_x250_to_300_then_x0_to_50');
    assert.equal(seam.source_regions.length, 2);
    const pixels = await sharp(Buffer.from(seam.url.split(',')[1], 'base64')).raw().toBuffer();
    assert.deepEqual([...pixels.subarray(0, 3)], [0, 0, 255]);
    assert.deepEqual([...pixels.subarray(50 * 3, 50 * 3 + 3)], [255, 0, 0]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('batch execution caches passes, resumes failures and invalidates changed images', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prove-it-batch-'));
  try {
    const input = join(dir, 'in'), output = join(dir, 'out'); await mkdir(input);
    const image = join(input, 'test.png');
    await sharp({ create: { width: 20, height: 20, channels: 3, background: 'blue' } }).png().toFile(image);
    const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
    config.default_claims = [claim]; config.retries = 0; config.image_projection = 'flat';
    const models = [{ id: 'a', model: 'a', passes: 2, weight: 1 }];
    let calls = 0;
    const mock = async (m, c, v, p) => { calls++; if (p === 2 && calls === 2) throw new Error('Simulated timeout'); return record(m.id, p, 'supported', .9); };
    const jobs = await buildJobs(config, input);
    assert.equal(await runBatch(config, jobs, models, output, null, { mock: true }, mock), 2);
    assert.equal(await runBatch(config, jobs, models, output, null, { mock: true }, mock), 0);
    assert.equal(calls, 3);
    const result = JSON.parse(await readFile(join(output, 'latest.json')));
    assert.equal(result.items[0].decisions[0].verdict, 'supported');
    assert.deepEqual(result.items[0].decisions[0].evidence, ['test.png']);
    await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).png().toFile(image);
    await runBatch(config, jobs, models, output, null, { mock: true }, mock);
    assert.equal(calls, 5);
    await writeFile(join(input, 'claims.json'), JSON.stringify({ claims: [{ ...claim, image: 'missing.png' }] }));
    await assert.rejects(buildJobs(config, input));
    assert.throws(() => validateConfig({ ...config, models: [{ ...config.models[0], passes: 0 }] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('prepared views are sent byte-for-byte and concurrent jobs checkpoint completely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prove-it-prepared-'));
  try {
    const file = join(dir, 'overview.jpg');
    await sharp({ create: { width: 20, height: 12, channels: 3, background: 'blue' } }).jpeg().toFile(file);
    const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url)));
    config.concurrency = 3; config.retries = 0;
    const jobs = ['one', 'two', 'three'].map(id => ({ id, images: [file], citations: [`${id}/color.png`],
      prepared_views: [{ name: 'image', file }], claims: [claim] }));
    const views = await jobViews(jobs[0], config);
    assert.deepEqual(Buffer.from(views[0].url.split(',')[1], 'base64'), await readFile(file));
    let active = 0, maximum = 0;
    const mock = async (m, c, v, p) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 20)); active--;
      return record(m.id, p, 'supported', .9);
    };
    const output = join(dir, 'results');
    await runBatch(config, jobs, [{ id: 'a', model: 'a', passes: 1, weight: 1 }], output, null, { mock: true }, mock);
    assert.equal(maximum, 3);
    const result = JSON.parse(await readFile(join(output, 'latest.json')));
    assert.deepEqual(result.items.map(i => i.id), ['one', 'two', 'three']);
    assert.equal(result.items[0].view_manifest[0].file, file);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
