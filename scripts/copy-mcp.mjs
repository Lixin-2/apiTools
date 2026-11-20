import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suffix = process.platform === 'win32' ? '.exe' : '';
const source = path.join(root, 'src-tauri/target/release/apitools-mcp' + suffix);
const targetDir = path.join(root, 'src-tauri/binaries');
const target = path.join(targetDir, 'apitools-mcp' + suffix);

if (!fs.existsSync(source)) {
  console.error(`[copy-mcp] 未找到编译产物: ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`[copy-mcp] ${target} (${size} MB)`);
