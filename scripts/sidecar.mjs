// Builds the MCP server and places it where Tauri bundles external binaries,
// with the target-triple suffix Tauri expects.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const debug = process.argv.includes('--debug');
const host = /host: (\S+)/.exec(execSync('rustc -vV').toString())[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const ext = target.includes('windows') ? '.exe' : '';

const profile = debug ? [] : ['--release'];
const args = ['build', '-p', 'ultimatemd-mcp', '--target', target, ...profile];
execSync(`cargo ${args.join(' ')}`, { stdio: 'inherit' });

mkdirSync('src-tauri/binaries', { recursive: true });
copyFileSync(
  `target/${target}/${debug ? 'debug' : 'release'}/ultimatemd-mcp${ext}`,
  `src-tauri/binaries/ultimatemd-mcp-${target}${ext}`,
);
