import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const runTime = id => Date.parse(id.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3')) || 0;

// Keep raw run reports separately from per-pass inference caches and latest.json.
export async function archiveRuns(resultsDir, historyDir) {
  await mkdir(historyDir, { recursive: true });
  await mkdir(resultsDir, { recursive: true });
  const runs = new Map();
  async function collect(file) {
    const report = JSON.parse(await readFile(file, 'utf8'));
    if (!report.run_id || !Array.isArray(report.items) || report.mock) return;
    const old = runs.get(report.run_id);
    if (!old || report.items.length > old.items.length) runs.set(report.run_id, report);
  }
  for (const entry of await readdir(historyDir, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.json')) await collect(join(historyDir, entry.name));
  for (const folder of await readdir(resultsDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const entry of await readdir(join(resultsDir, folder.name), { withFileTypes: true })) {
      if (!entry.isFile() || !/^(latest|\d{4}-\d{2}-\d{2}T.+)\.json$/.test(entry.name)) continue;
      await collect(join(resultsDir, folder.name, entry.name));
    }
  }
  for (const report of runs.values()) {
    const name = report.run_id.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json';
    await writeFile(join(historyDir, name), JSON.stringify(report, null, 2) + '\n');
  }
  return [...runs.values()].sort((a,b)=>runTime(b.run_id)-runTime(a.run_id));
}
