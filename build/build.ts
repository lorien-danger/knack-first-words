/**
 * Builds the full "First words" dataset (../local) from words.tsv (word, picture, group):
 *   picture  photos picked by hand from Wikipedia / Wikimedia Commons, media/photos/<word>-<n>.jpg: one row per photo,
 *            so a word comes back with a different picture (what stays the same is the word). A word with no photos
 *            gets the Microsoft Fluent emoji (MIT), the flat "Color" SVG drawn at 768 px, as its one picture.
 *   say      the word in the four Australian Google Cloud Neural2 voices (two women, two men), one file each
 *            (Neural2 was picked by ear over Chirp 3 HD, whose "Australian" voices often sound American)
 *   sounds   how each voice sounds to the speech model (say.sounds.bin/.json) - what a recording is compared with
 *            (engine/speech.ts)
 *   and what the word looks like on the page: letters, first and last letter, length, shape (x small, l tall,
 *   p hanging below the line), plus how it sounds and its group.
 * Re-running only fetches what's missing.
 *
 *   cd build && npm install && npx tsx build.ts [--env <file>]     (needs GC_API_KEY, from the env or that file)
 *
 * How a voice sounds to the speech model is worked out by the Knack app's own code, so the app must be checked out
 * at ../../../knack (or KNACK_APP), with its packages installed.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const HERE = new URL('.', import.meta.url).pathname;
const { decode, listen, sounds, transcribe, writeSounds } = await import(join(process.env.KNACK_APP ?? join(HERE, '../../../knack'), 'src/lib/engine/speech.ts'));
type Sounds = any;

const OUT = join(HERE, '../local');
const VOICES = ['en-AU-Neural2-A', 'en-AU-Neural2-B', 'en-AU-Neural2-C', 'en-AU-Neural2-D'];
const short = (v: string) => v.replace(/^en-AU-/, '').toLowerCase();
const RATE = 0.85; // a little slower than normal, for small listeners

const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
async function apiKey() {
	if (process.env.GC_API_KEY) return process.env.GC_API_KEY;
	const env = await readFile(arg('--env', '../piknik-audiobook/.env'), 'utf8');
	const m = /^GC_API_KEY=(.*)$/m.exec(env);
	if (!m) throw new Error('No GC_API_KEY');
	return m[1].trim().replace(/^["']|["']$/g, '');
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
	let next = 0;
	await Promise.all([...Array(n)].map(async () => { while (next < items.length) await f(items[next++]); }));
}

const words = (await readFile(join(HERE, 'words.tsv'), 'utf8')).trim().split('\n').map((l) => {
	const [word, picture, group] = l.split('\t');
	return { word, picture, group };
});
await mkdir(join(OUT, 'media', 'pictures'), { recursive: true });
await mkdir(join(OUT, 'media', 'say'), { recursive: true });

// pictures
const tree: string[] = (await (await fetch('https://api.github.com/repos/microsoft/fluentui-emoji/git/trees/main?recursive=1')).json()).tree?.map((x: { path: string }) => x.path) ?? [];
const photos = (await readdir(join(OUT, 'media', 'photos')).catch(() => [] as string[])).filter((f) => f.endsWith('.jpg'));
const photosOf = (w: string) => photos.filter((f) => f.startsWith(`${w}-`) && /^\d+$/.test(f.slice(w.length + 1, -4)))
	.sort((a, b) => Number(a.slice(w.length + 1, -4)) - Number(b.slice(w.length + 1, -4))).map((f) => `media/photos/${f}`);
await pool(words, 8, async (w) => {
	const out = join(OUT, 'media', 'pictures', `${w.word}.png`);
	if (photosOf(w.word).length || existsSync(out)) return;
	const path = tree.find((p) => p.startsWith(`assets/${w.picture}/`) && /\/(Default\/)?Color\/[^/]+\.svg$/.test(p));
	if (!path) throw new Error(`No picture "${w.picture}" for ${w.word}`);
	const svg = Buffer.from(await (await fetch(`https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/${path.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer());
	await sharp(svg, { density: 600 }).resize(768, 768, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out);
});
console.log(`pictures: ${words.length}`);

// voices
const jobs = words.flatMap((w) => VOICES.map((v) => ({ w, v, file: join(OUT, 'media', 'say', `${w.word}.${short(v)}.wav`) })));
const missing = jobs.filter((j) => !existsSync(j.file));
const key = missing.length ? await apiKey() : '';
await pool(missing, 2, async ({ w, v, file }) => {
	for (let wait = 2000; ; wait *= 2) {
		const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ input: { text: w.word }, voice: { languageCode: 'en-AU', name: v }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: RATE } })
		});
		const j = await r.json();
		if (j.audioContent) return writeFile(file, Buffer.from(j.audioContent, 'base64'));
		// a per-minute quota, and the odd one-off failure: wait and try again, then go without this voice
		if (wait < 64000) { await new Promise((ok) => setTimeout(ok, wait)); continue; }
		console.log(`no ${short(v)} for ${w.word}: ${JSON.stringify(j).slice(0, 160)}`);
		return;
	}
});
console.log(`voices: ${jobs.length} recordings`);

// how each voice sounds to the speech model: what a recording is compared with, and what it writes down
const heardAs: Record<string, string[][]> = {}, refs: Record<string, Sounds[]> = {};
let dim = 0;
for (const { w, file } of jobs.filter((j) => existsSync(j.file))) {
	const f = await listen(await decode(file));
	dim = f[0].length;
	(heardAs[w.word] ??= []).push(await transcribe(f));
	(refs[w.word] ??= []).push(await sounds(f));
}
await writeSounds(join(OUT, 'say.sounds'), refs, dim);

// the commonest way the voices were heard (ties: the first voice), for "sounds"
const commonest = (xs: string[][]) => {
	const n = new Map<string, number>();
	for (const x of xs) n.set(x.join(' '), (n.get(x.join(' ')) ?? 0) + 1);
	return [...n].sort((a, b) => b[1] - a[1])[0][0].split(' ');
};
const shape = (w: string) => [...w].map((c) => ('bdfhklt'.includes(c) ? 'l' : 'gjpqy'.includes(c) ? 'p' : 'x')).join('');
// one row per picture; the first keeps the plain word as its id (so does the speech model's entry: rows that
// share a recording share how it sounds)
const rows = words.flatMap((w) => (photosOf(w.word).length ? photosOf(w.word) : [`media/pictures/${w.word}.png`]).map((picture, n) => ({
	id: n ? `${w.word}-${n}` : w.word,
	word: w.word,
	picture,
	say: VOICES.map((v) => `media/say/${w.word}.${short(v)}.wav`).filter((f) => existsSync(join(OUT, f))),
	sounds: commonest(heardAs[w.word]),
	letters: [...new Set(w.word)],
	'first letter': w.word[0],
	'last letter': w.word.at(-1),
	length: w.word.length,
	shape: shape(w.word),
	group: w.group
})));
await writeFile(join(OUT, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
await writeFile(join(OUT, 'columns.json'), JSON.stringify({
	name: 'First words',
	item: 'picture',
	practices: [{ show: ['word'], ask: 'say' }, { show: ['picture'], ask: 'say' }, { show: ['say'], ask: 'picture' }],
	scope: ['word', 'letters', 'first letter', 'last letter', 'length', 'shape', 'sounds', 'group'],
	columns: [
		{ name: 'word', type: 'text', font: 'reading' },
		{ name: 'picture', type: 'plain', media: 'image' },
		{ name: 'say', type: 'plain', media: 'audio', speech: 'say.sounds' },
		{ name: 'sounds', type: 'text' },
		{ name: 'letters', type: 'parts' },
		{ name: 'first letter', type: 'plain' },
		{ name: 'last letter', type: 'plain' },
		{ name: 'length', type: 'number' },
		{ name: 'shape', type: 'text' },
		{ name: 'group', type: 'plain' }
	]
}, null, 1));

// how well this hears real children: knack-lab/scripts/eval-children.ts
