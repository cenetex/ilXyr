// Reconstruct historical inputs with the bound upstream normalization functions.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [source, raw, output] = process.argv.slice(2);
const prep = path.join(output, 'historical-preparer.mjs');
fs.writeFileSync(prep, fs.readFileSync(path.join(source, 'scripts/prepare_zero_eval1.mjs'), 'utf8') +
  '\nexport { normalize, prepareBlimp, prepareTinyStories };\n', { flag: 'wx' });
const sample = path.join(output, 'historical-sampler.mjs');
fs.writeFileSync(sample, fs.readFileSync(path.join(source, 'scripts/sample_zero_eval1_screen.mjs'), 'utf8') +
  '\nexport { readDataset, blimpQuotas, selectByGroup };\n', { flag: 'wx' });
const p = await import(pathToFileURL(prep));
const s = await import(pathToFileURL(sample));
const stats = { combining_marks_removed: 0, non_ascii_replaced: 0 };
p.prepareBlimp(path.join(output, 'blimp-source'), output, stats);
p.prepareTinyStories(path.join(raw, 'tinystories_validation.txt'), output, stats);
const { header, rows } = s.readDataset(path.join(output, 'blimp.tsv'));
const selected = s.selectByGroup(rows, s.blimpQuotas(rows));
fs.writeFileSync(path.join(output, 'old-blimp-screen.tsv'), header + '\n' + selected.map(r => r.line).join('\n') + '\n');
const stories = fs.readFileSync(path.join(raw, 'tinystories_validation.txt'), 'utf8')
  .split('<|endoftext|>').map(story => p.normalize(story, stats)).filter(story => story.length >= 128);
fs.writeFileSync(path.join(output, 'stories.jsonl'), stories.map((story, index) => JSON.stringify({ index, story })).join('\n') + '\n');
fs.writeFileSync(path.join(output, 'normalization.json'), JSON.stringify(stats, null, 2) + '\n');
