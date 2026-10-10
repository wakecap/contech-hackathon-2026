import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const file = resolve(root, process.argv[2] || join(config.output_dir, 'latest.json'));
const report = JSON.parse(await readFile(file, 'utf8'));
const decisions = report.items.flatMap(i => i.decisions);
const totals = {};
let citations = 0;
for (const item of report.items) {
  for (const d of item.decisions) {
    totals[d.verdict || d.status] = (totals[d.verdict || d.status] || 0) + 1;
    for (const evidence of d.evidence) {
      if (!item.images.includes(evidence)) throw new Error('Citation does not belong to its input image.');
      await access(resolve(root, config.input_dir, evidence)); citations++;
    }
  }
}
const clean = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [`# Five-image model trial`, '',
  `${report.items.length} panoramas; ${decisions.length} claims. One configured pass per model.`, '',
  `Results: ${Object.entries(totals).map(([key, n]) => `${n} ${key}`).join(', ')}.`, '',
  'These are model decisions and agreement scores, not accuracy against the private answer key.', '',
  '| Claim | Statement | Luna (confidence) | DeepSeek (confidence) | Final |',
  '|---|---|---|---|---|'];
for (const item of report.items) for (const d of item.decisions) {
  const vote = id => item.records.filter(r => r.modelId === id).map(r => {
    const v = r.decisions.find(x => x.claimId === d.claimId);
    return v ? `${v.verdict} (${Math.round(v.confidence * 100)}%)` : 'missing';
  }).join('; ');
  lines.push(`| ${clean(d.claimId)} | ${clean(d.statement)} | ${vote('luna')} | ${vote('deepseek')} | ${d.verdict || d.status} |`);
}
lines.push('', '## Evidence and review notes', '');
for (const item of report.items) {
  lines.push(`### ${item.id}`, '');
  for (const d of item.decisions) {
    lines.push(`**${d.claimId}: ${d.verdict || d.status}** — ${d.statement}`, '');
    for (const r of item.records) {
      const v = r.decisions.find(x => x.claimId === d.claimId);
      if (v) lines.push(`- ${r.modelId}: ${v.observation}${v.limitation ? ` Limitation: ${v.limitation}` : ''}`);
    }
    lines.push('');
  }
}
const output = join(dirname(file), 'review.md');
await writeFile(output, lines.join('\n') + '\n');
console.log(JSON.stringify({ panoramas: report.items.length, claims: decisions.length, totals,
  successful_model_calls: report.items.reduce((n, i) => n + i.records.length, 0),
  failed_passes: report.items.flatMap(i => i.errors).length, checked_citations: citations, report: output }, null, 2));
