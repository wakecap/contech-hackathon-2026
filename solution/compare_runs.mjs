import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(await readFile(resolve(root, process.argv[2] || 'results/track_a_sample5/latest.json'), 'utf8'));
const trialFile = resolve(root, process.argv[3] || 'results/track_a_crop_trial/latest.json');
const trial = JSON.parse(await readFile(trialFile, 'utf8'));
const votes = report => new Map(report.items.flatMap(item => item.records
  .filter(record => record.modelId === 'deepseek').flatMap(record => record.decisions.map(d => [d.claimId, d]))));
const before = votes(baseline), after = votes(trial);
if (before.size !== after.size || [...before.keys()].some(key => !after.has(key))) throw new Error('Reports do not contain the same DeepSeek claims.');
const lines = ['# DeepSeek crop comparison', '',
  'Baseline: overview + four 1024-pixel crops. Trial: overview + five 768-pixel crops + one seam crop.', '',
  'Same five panoramas, 15 claims, prompts, model, and one pass per condition. OpenAI was disabled for the trial.', '',
  'Confidence is model-reported. This comparison measures answer changes, not accuracy. A single pass also includes sampling variation.', '',
  '| Claim | Baseline DeepSeek | Narrow crops + seam | Verdict changed |', '|---|---|---|---|'];
let changes = 0;
for (const [id, old] of before) {
  const current = after.get(id), changed = old.verdict !== current.verdict;
  if (changed) changes++;
  lines.push(`| ${id} | ${old.verdict} (${Math.round(old.confidence * 100)}%) | ${current.verdict} (${Math.round(current.confidence * 100)}%) | ${changed ? 'yes' : 'no'} |`);
}
lines.push('', `${changes}/${before.size} verdicts changed. Independent visual labels are needed to decide which answers are correct.`, '');
const output = join(dirname(trialFile), 'comparison.md');
await writeFile(output, lines.join('\n'));
console.log(JSON.stringify({ compared_claims: before.size, changed_verdicts: changes, comparison: output }, null, 2));
