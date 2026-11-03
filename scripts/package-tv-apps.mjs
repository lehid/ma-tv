// Prépare les applis TV « coquilles » non signées dans dist-tv/ :
//   dist-tv/tizen/ + dist-tv/ma-tv-tizen.wgt   (à signer avec `tizen package -t wgt -s <profil>`)
//   dist-tv/webos/ + dist-tv/ma-tv-webos.zip   (dossier prêt pour `ares-package dist-tv/webos`)
// __SITE_URL__ / __SITE_HOST__ sont remplacés à partir de config.json → siteUrl (seule source de l'URL).
import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipStore } from './lib/zip.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
const siteUrl = String(config.siteUrl || '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+/.test(siteUrl)) throw new Error(`config.json → siteUrl invalide : « ${config.siteUrl} » (https:// attendu)`);
const siteHost = new URL(siteUrl).host;

const TEXT = new Set(['.html', '.xml', '.json', '.js', '.css', '.txt']);
const APPS = [['tizen', 'ma-tv-tizen.wgt'], ['webos', 'ma-tv-webos.zip']];

async function walk(dir) {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p));
    else if (!d.name.startsWith('.')) out.push(p);
  }
  return out.sort();
}

const outDir = join(root, 'dist-tv');
await rm(outDir, { recursive: true, force: true });
for (const [app, archive] of APPS) {
  const src = join(root, 'tv-apps', app);
  const files = [];
  for (const file of await walk(src)) {
    const rel = relative(src, file).split('\\').join('/');
    let data = await readFile(file);
    if (TEXT.has(extname(file))) {
      data = Buffer.from(data.toString('utf8').split('__SITE_URL__').join(siteUrl).split('__SITE_HOST__').join(siteHost));
    }
    const dest = join(outDir, app, rel);
    await mkdir(join(dest, '..'), { recursive: true });
    await writeFile(dest, data);
    files.push([rel, data]);
  }
  const left = files.filter(([, d]) => d.includes('__SITE_'));
  if (left.length) throw new Error(`Placeholder non remplacé dans ${left.map(([n]) => n).join(', ')}`);
  await writeFile(join(outDir, archive), zipStore(files));
  console.log(`dist-tv/${archive} : ${files.map(([n]) => n).join(', ')}`);
}
console.log(`URL du site : ${siteUrl}/ (hôte ${siteHost})`);
