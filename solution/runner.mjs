import { readFile, writeFile, mkdir, readdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, join, relative, dirname, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SubscriptionAuth } from './auth.mjs';
import { prepareImage } from './images.mjs';
import { inspect, INSTRUCTIONS, SCHEMA, safeError } from './providers.mjs';
import { aggregate, validateDecisions } from './voting.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function saveJSON(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}
export function validateConfig(c) {
  if (!['batch', 'track_a'].includes(c.mode) || !['flat', 'equirectangular', 'panorama_strip'].includes(c.image_projection)) throw new Error('Invalid mode or image_projection.');
  const models = c.models?.filter(m => m.enabled);
  if (!models?.length) throw new Error('Enable at least one model.');
  const ids = new Set();
  for (const m of models) {
    if (!m.id || ids.has(m.id) || !m.model || !['openai', 'deepseek'].includes(m.provider) ||
      !Number.isInteger(m.passes) || m.passes < 1 || !Number.isFinite(m.weight) || m.weight <= 0 ||
      (m.provider === 'openai' && !['subscription', 'api_key'].includes(m.auth))) throw new Error('Invalid model config or duplicate model ID.');
    ids.add(m.id);
  }
  for (const key of ['face_size', 'max_image_edge', 'request_timeout_seconds'])
    if (!Number.isInteger(c[key]) || c[key] < 1) throw new Error(`Invalid ${key}.`);
  if (c.face_size > 2048 || c.max_image_edge > 8192) throw new Error('Image dimensions exceed configured safety limits.');
  if (c.crop_width !== undefined && (!Number.isInteger(c.crop_width) || c.crop_width < 64 || c.crop_width > 4096)) throw new Error('crop_width must be an integer from 64 to 4096.');
  if (c.crop_overlap !== undefined && (!Number.isFinite(c.crop_overlap) || c.crop_overlap < 0 || c.crop_overlap > .75)) throw new Error('crop_overlap must be 0..0.75.');
  if (c.include_seam_crop !== undefined && typeof c.include_seam_crop !== 'boolean') throw new Error('include_seam_crop must be boolean.');
  if (!Number.isInteger(c.retries) || c.retries < 0 || c.retries > 10) throw new Error('retries must be 0..10.');
  for (const key of ['minimum_winner_share', 'minimum_margin'])
    if (!Number.isFinite(c.aggregation?.[key]) || c.aggregation[key] < 0 || c.aggregation[key] > 1) throw new Error(`Invalid aggregation ${key}.`);
  if (!Number.isFinite(c.aggregation.minimum_winner_points) || c.aggregation.minimum_winner_points < 0 || c.aggregation.minimum_winner_points > 100)
    throw new Error('minimum_winner_points must be 0..100.');
  return models;
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile() && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(file).toLowerCase())) files.push(file);
  }
  return files.sort();
}

function validateClaims(claims) {
  if (!claims?.length || claims.some(c => !c.claimId || typeof c.statement !== 'string' || !c.statement.trim()) ||
    new Set(claims.map(c => c.claimId)).size !== claims.length) throw new Error('Claims require unique claimId values and nonempty statements.');
}

export async function buildJobs(config, input) {
  if (config.mode === 'track_a') {
    const data = resolve(ROOT, '../data/track_a');
    const { claims } = await json(join(data, 'claims.json'));
    const { scenes } = await json(join(data, 'scenes.json'));
    validateClaims(claims);
    const jobs = [];
    for (const scene of scenes) {
      const selected = claims.filter(c => c.sceneId === scene.sceneId);
      if (!selected.length) continue;
      if (!scene.panoramas?.length) throw new Error(`No panorama listed for ${scene.sceneId}.`);
      const paths = scene.panoramas.map(p => {
        const file = resolve(input, p);
        if (isAbsolute(p) || relative(input, file).startsWith('..')) throw new Error('Unsafe panorama path.');
        return file;
      });
      jobs.push({ id: scene.sceneId, images: paths, citations: scene.panoramas,
        claims: selected.map(({ claimId, statement, category }) => ({ claimId, statement, category })) });
    }
    if (jobs.flatMap(j => j.claims).length !== claims.length) throw new Error('Some claims reference missing scenes.');
    return jobs;
  }
  const files = await walk(input);
  if (!files.length) throw new Error(`No images found in ${input}.`);
  let manifest;
  try { manifest = await json(join(input, 'claims.json')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (manifest && !Array.isArray(manifest.claims)) throw new Error('claims.json needs a claims array.');
  const jobs = files.map(file => {
    const image = relative(input, file).replaceAll('\\', '/');
    const claims = manifest ? manifest.claims.filter(c => c.image === image).map(({ claimId, statement, category }) => ({ claimId, statement, ...(category ? { category } : {}) })) : config.default_claims;
    validateClaims(claims);
    return { id: image, images: [file], citations: [image], claims };
  });
  if (manifest && manifest.claims.length !== jobs.flatMap(j => j.claims).length) throw new Error('claims.json references images not found in this batch.');
  return jobs;
}

async function loadEnv() {
  let source;
  try { source = await readFile(join(ROOT, '.env'), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function argsFrom(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (['--config', '--input', '--account'].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}.`);
      options[key.slice(2)] = argv[++i];
    } else if (['--dry-run', '--login', '--new-account', '--accounts', '--models', '--fresh', '--help'].includes(key)) options[key.slice(2)] = true;
    else throw new Error(`Unknown option ${key}.`);
  }
  return options;
}

export async function runBatch(config, jobs, models, output, auth, options = {}, call = inspect) {
  await mkdir(output, { recursive: true });
  const runId = new Date().toISOString().replaceAll(':', '-');
  const report = { run_id: runId, mode: config.mode, mock: !!options.mock, items: [] };
  let failures = 0;
  for (const job of jobs) {
    console.log(`Inspecting ${job.id} (${job.claims.length} claims)`);
    const views = [];
    for (let i = 0; i < job.images.length; i++) {
      const prepared = await prepareImage(job.images[i], config);
      for (const view of prepared) views.push({ ...view, name: job.images.length === 1 ? view.name : `pano_${i + 1}/${view.name}` });
    }
    const signature = hash(JSON.stringify({ images: views, claims: job.claims, prompt: INSTRUCTIONS, schema: SCHEMA,
      preparation: [config.image_projection, config.face_size, config.max_image_edge], models, mock: !!options.mock }));
    const cacheDir = join(output, 'cache', signature);
    const records = [], errors = [];
    for (const model of models) for (let pass = 1; pass <= model.passes; pass++) {
      const cache = join(cacheDir, `${hash(model.id).slice(0, 12)}-${pass}.json`);
      let record;
      if (!options.fresh) {
        try {
          record = await json(cache);
          if (record.modelId !== model.id || record.model !== model.model || record.pass !== pass) throw new Error('Invalid cached model/pass metadata.');
          validateDecisions(record, job.claims, views.map(v => v.name));
        }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      if (record) console.log(`  ${model.id} pass ${pass}: cached`);
      else {
        for (let attempt = 0; attempt <= config.retries; attempt++) {
          try { record = await call(model, job.claims, views, pass, config, auth); await saveJSON(cache, record); break; }
          catch (e) {
            if (e.diagnostic) {
              const diagnosticFile = join(output, 'diagnostics', `${runId}-${hash(job.id + model.id).slice(0, 12)}-${pass}-${attempt}.json`);
              await saveJSON(diagnosticFile, { modelId: model.id, pass, attempt, ...e.diagnostic });
              console.log(`  Response diagnostic saved: ${diagnosticFile}`);
            }
            if (e.status && e.status !== 408 && e.status !== 429 && e.status < 500) {
              errors.push({ modelId: model.id, pass, error: safeError(e) }); break;
            }
            if (attempt === config.retries) errors.push({ modelId: model.id, pass, error: safeError(e) });
            else { console.log(`  ${model.id} pass ${pass}: retrying (${safeError(e)})`); await sleep(1000 * 2 ** attempt); }
          }
        }
        console.log(`  ${model.id} pass ${pass}: ${record ? 'complete' : 'FAILED'}`);
      }
      if (record) records.push(record);
    }
    const decisions = job.claims.map(claim => {
      const decision = aggregate(claim.claimId, models, records, config.aggregation);
      const supporting = records.flatMap(r => r.decisions).filter(d => d.claimId === claim.claimId && d.verdict === decision.verdict)
        .sort((a, b) => b.confidence - a.confidence);
      const observation = supporting[0]?.observation || '';
      const evidenceViews = [...new Set(supporting.flatMap(d => d.views))];
      const citations = decision.verdict && decision.verdict !== 'no_evidence' ? job.citations.filter((_, i) =>
        job.images.length === 1 ? evidenceViews.length : evidenceViews.some(v => v.startsWith(`pano_${i + 1}/`))) : [];
      if (decision.status !== 'ok') failures++;
      return { ...decision, statement: claim.statement, observation, evidence_views: evidenceViews, evidence: citations };
    });
    report.items.push({ id: job.id, images: job.citations,
      view_manifest: views.map(({ name, source_regions }) => ({ name, ...(source_regions ? { source_regions } : {}) })),
      records, errors, decisions });
    await saveJSON(join(output, 'latest.json'), report);
  }
  await saveJSON(join(output, `${runId}.json`), report);
  if (config.mode === 'track_a' && !failures && !options.mock) {
    if (!config.team?.trim() || config.team === 'TEAM_NAME') throw new Error('Set a real team name before emitting the submission. Results are saved.');
    const entries = report.items.flatMap(item => item.decisions.map(d => ({ claimId: d.claimId, verdict: d.verdict,
      ...(d.evidence.length ? { evidence: d.evidence } : {}), rationale: d.observation })));
    await saveJSON(join(output, `submission-${runId}.json`), { team: config.team, track_a: entries, track_b: [] });
  }
  console.log(`Results: ${join(output, 'latest.json')}. ${failures} claims need review or retry.`);
  return failures ? 2 : 0;
}

async function main() {
  const options = argsFrom(process.argv.slice(2));
  if (options.help) { console.log('run_images.bat [--input FOLDER] [--config FILE] [--dry-run] [--fresh]\nAccount options: --login, --new-account, --accounts, --account NUMBER, --models'); return; }
  const configPath = resolve(ROOT, options.config || 'config.json');
  const config = await json(configPath);
  const models = validateConfig(config);
  await loadEnv();
  const local = join(ROOT, '.local');
  await mkdir(local, { recursive: true });
  let lock;
  try { lock = await open(join(local, 'runner.lock'), 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('Another runner is active. If it crashed, remove solution/.local/runner.lock and retry.'); throw e; }
  try {
    let auth;
    const accountAction = options.login || options['new-account'] || options.accounts || options.account || options.models;
    if (accountAction) {
      auth = await new SubscriptionAuth(local).load();
      if (options.account) await auth.select(Number(options.account));
      if (options.accounts) console.table(auth.list());
      if (options.login || options['new-account']) await auth.login(!!options['new-account']);
      if (options.models) console.table((await auth.models()).map(m => ({ slug: m.slug, name: m.display_name })));
      return;
    }
    const input = resolve(dirname(configPath), options.input || config.input_dir);
    const output = resolve(dirname(configPath), config.output_dir);
    const jobs = await buildJobs(config, input);
    // Decode all images before sign-in or any request: missing/broken images are failures.
    for (const job of jobs) for (const file of job.images) await prepareImage(file, config);
    console.log(`${jobs.length} image/scene jobs; ${jobs.reduce((n, j) => n + j.claims.length, 0)} claims; ${jobs.length * models.reduce((n, m) => n + m.passes, 0)} configured calls before cache reuse.`);
    if (options['dry-run']) { console.log('Dry run passed. No login, uploads, or inference performed.'); return; }
    if (models.some(m => m.provider === 'deepseek') && !process.env.DEEPSEEK_API_KEY) throw new Error('DeepSeek is enabled but DEEPSEEK_API_KEY is missing.');
    if (models.some(m => m.provider === 'openai' && m.auth === 'api_key') && !process.env.OPENAI_API_KEY) throw new Error('API-key mode selected but OPENAI_API_KEY is missing.');
    if (models.some(m => m.auth === 'subscription')) {
      auth = await new SubscriptionAuth(local).load();
      const available = await auth.models();
      for (const m of models.filter(m => m.auth === 'subscription')) {
        if (!available.some(a => a.slug === m.model)) throw new Error(`${m.model} is unavailable to this signed-in ChatGPT account. Use --models to inspect access.`);
      }
    }
    process.exitCode = await runBatch(config, jobs, models, output, auth, options);
  } finally { await lock.close(); await unlink(join(local, 'runner.lock')); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(e => { console.error(safeError(e)); process.exitCode = 1; });
