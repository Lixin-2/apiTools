import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'src-tauri/target/release/apitools-mcp');
const targetDir = path.join(root, 'src-tauri/binaries');
const target = path.join(targetDir, 'apitools-mcp');

if (!fs.existsSync(source)) {
  console.error(`[copy-mcp] 未找到编译产物: ${source}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
fs.chmodSync(target, 0o755);
const size = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(`[copy-mcp] ${target} (${size} MB)`);
