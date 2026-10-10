import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildJobs, validateConfig } from './runner.mjs';
import { prepareImage } from './images.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(root, process.argv[2] || 'config.crop-trial.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
validateConfig(config);
const jobs = await buildJobs(config, resolve(dirname(configPath), config.input_dir));
const output = resolve(dirname(configPath), config.output_dir, 'previews');
let total = 0;
for (const job of jobs) {
  const directory = join(output, job.id.replaceAll('/', '_').replace(/[^a-zA-Z0-9_.-]/g, '_'));
  await mkdir(directory, { recursive: true });
  const views = await prepareImage(job.images[0], config);
  const manifest = [];
  const composites = [];
  const cellWidth = 400, cellHeight = 480;
  for (let i = 0; i < views.length; i++) {
    const view = views[i], name = `${i}-${view.name}.png`;
    const pixels = Buffer.from(view.url.split(',')[1], 'base64');
    await writeFile(join(directory, name), pixels);
    manifest.push({ name: view.name, file: name, source_regions: view.source_regions });
    const thumbnail = await sharp(pixels).resize({ width: 384, height: 427, fit: 'contain', background: '#222222' }).png().toBuffer();
    const left = (i % 3) * cellWidth, top = Math.floor(i / 3) * cellHeight;
    composites.push({ input: thumbnail, left: left + 8, top: top + 36 });
    const label = `<svg width="400" height="32"><text x="8" y="22" fill="white" font-size="13" font-family="sans-serif">${view.name}</text></svg>`;
    composites.push({ input: Buffer.from(label), left, top });
  }
  await sharp({ create: { width: 3 * cellWidth, height: Math.ceil(views.length / 3) * cellHeight,
    channels: 3, background: '#222222' } }).composite(composites).png().toFile(join(directory, 'contact.png'));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ source: job.images[0], views: manifest }, null, 2));
  total += views.length;
}
console.log(JSON.stringify({ panoramas: jobs.length, exported_views: total, directory: output, uploads: 0 }, null, 2));
