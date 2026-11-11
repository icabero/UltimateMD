// Fails when the version is not the same everywhere it is written, or, on a
// release tag, when the tag names another one. Run by the CI and by
// `npm run lint`.
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const json = (path) => JSON.parse(read(path));

const found = {
  'package.json': json('package.json').version,
  'package-lock.json': json('package-lock.json').version,
  'package-lock.json (root package)': json('package-lock.json').packages?.['']?.version,
  'src-tauri/tauri.conf.json': json('src-tauri/tauri.conf.json').version,
  'Cargo.toml': /\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(read('Cargo.toml'))?.[1],
};
// Cargo.lock names each crate of the workspace with the version it was built at.
for (const crate of ['ultimatemd', 'ultimatemd-core', 'ultimatemd-mcp', 'ultimatemd-pdf']) {
  found[`Cargo.lock (${crate})`] = new RegExp(`name = "${crate}"\r?\nversion = "([^"]+)"`).exec(read('Cargo.lock'))?.[1];
}

const expected = found['package.json'];
const wrong = Object.entries(found).filter(([, version]) => version !== expected);
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
if (tag && tag !== `v${expected}`) wrong.push(['the tag', tag]);

if (wrong.length) {
  console.error(`The version should be ${expected} everywhere${tag ? `, and the tag v${expected}` : ''}:`);
  for (const [where, version] of wrong) console.error(`  ${where}: ${version ?? 'not found'}`);
  process.exit(1);
}
console.log(`Version ${expected} in ${Object.keys(found).length} places.`);
