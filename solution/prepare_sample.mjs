import { readFile, mkdir, copyFile, access, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '..');
const claims = JSON.parse(await readFile(join(repo, 'data/track_a/claims.json'), 'utf8')).claims;
const scenes = JSON.parse(await readFile(join(repo, 'data/track_a/scenes.json'), 'utf8')).scenes;
let source;
for (const candidate of ['data/track_a/panoramas', 'track_a/panoramas']) {
  try { await access(join(repo, candidate, scenes[0].panoramas[0])); source = join(repo, candidate); break; }
  catch {}
}
if (!source) throw new Error('Cannot find the installed Track A panorama pack.');
const covered = new Set(), sites = new Set(), chosen = [];
let candidates = scenes.filter(s => claims.some(c => c.sceneId === s.sceneId));
while (chosen.length < 5 && candidates.length) {
  candidates.sort((a, b) => {
    const score = s => (sites.has(s.site) ? 0 : 10) +
      new Set(claims.filter(c => c.sceneId === s.sceneId && !covered.has(c.category)).map(c => c.category)).size;
    return score(b) - score(a) || a.sceneId.localeCompare(b.sceneId);
  });
  const scene = candidates.shift(); chosen.push(scene); sites.add(scene.site);
  for (const c of claims.filter(c => c.sceneId === scene.sceneId)) covered.add(c.category);
}
const directory = join(root, 'batches/track_a_sample5');
const manifest = { claims: [] };
for (const scene of chosen) {
  if (scene.panoramas.length !== 1) throw new Error('Sample expects one panorama per scene.');
  const image = scene.panoramas[0];
  await mkdir(dirname(join(directory, image)), { recursive: true });
  await copyFile(join(source, image), join(directory, image));
  for (const c of claims.filter(c => c.sceneId === scene.sceneId))
    manifest.claims.push({ image, claimId: c.claimId, statement: c.statement, category: c.category });
}
await writeFile(join(directory, 'claims.json'), JSON.stringify(manifest, null, 2) + '\n');
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
config.mode = 'batch'; config.input_dir = 'batches/track_a_sample5';
config.output_dir = 'results/track_a_sample5'; config.image_projection = 'panorama_strip';
await writeFile(join(root, 'config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ source, selected: chosen.map(s => s.sceneId), images: chosen.length,
  claims: manifest.claims.length, categories: [...covered], output: config.output_dir }, null, 2));
