/**
 * Make the published dataset (this repo's root) from the full one in ../local. The full one has a row per photo;
 * those photos have no recorded source, so they stay on this computer, and so do the recordings. The published one
 * has one row per word, its picture the Microsoft Fluent emoji (MIT) linked from jsDelivr at a fixed commit, and
 * what the word looks like and sounds like.
 *   npx tsx publish.ts [out folder]      (default ..)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const SRC = join(HERE, '../local'), OUT = process.argv[2] ?? join(HERE, '..');
const FLUENT = 'microsoft/fluentui-emoji';

const sha: string = (await (await fetch(`https://api.github.com/repos/${FLUENT}/commits/main`)).json()).sha;
const tree: string[] = (await (await fetch(`https://api.github.com/repos/${FLUENT}/git/trees/${sha}?recursive=1`)).json()).tree.map((x: { path: string }) => x.path);
const local = new Map((await readFile(join(SRC, 'rows.jsonl'), 'utf8')).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).map((r) => [r.word as string, r]));
const list = (await readFile(join(HERE, 'words.tsv'), 'utf8')).trim().split('\n').map((l) => l.split('\t'));
const rows = list.map(([word, picture, group]) => {
	const path = tree.find((p) => p.startsWith(`assets/${picture}/`) && /\/(Default\/)?Color\/[^/]+\.svg$/.test(p));
	if (!path) throw new Error(`No picture "${picture}" for ${word}`);
	const r = local.get(word);
	if (!r) throw new Error(`${word} is not in ../local`);
	return {
		id: word, word,
		picture: `https://cdn.jsdelivr.net/gh/${FLUENT}@${sha}/${path.split('/').map(encodeURIComponent).join('/')}`,
		sounds: r.sounds, letters: r.letters, 'first letter': r['first letter'], 'last letter': r['last letter'],
		length: r.length, shape: r.shape, group
	};
});
const meta = {
	name: 'First words',
	item: 'word',
	practices: [{ name: 'Read it', show: ['word'], ask: 'picture', mark: 'self' }],
	scope: ['word', 'letters', 'first letter', 'last letter', 'length', 'shape', 'sounds', 'group'],
	columns: [
		{ name: 'word', type: 'text', font: 'reading' },
		{ name: 'picture', type: 'plain', media: 'image' },
		{ name: 'sounds', type: 'text' },
		{ name: 'letters', type: 'parts' },
		{ name: 'first letter', type: 'plain' },
		{ name: 'last letter', type: 'plain' },
		{ name: 'length', type: 'number' },
		{ name: 'shape', type: 'text' },
		{ name: 'group', type: 'plain' }
	]
};
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'columns.json'), JSON.stringify(meta, null, 1) + '\n');
await writeFile(join(OUT, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`${OUT}: ${rows.length} rows`);
