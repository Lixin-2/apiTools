import fs from 'node:fs';
import path from 'node:path';

// 从下载好的 CI 产物里挑出更新包，生成 Tauri updater 需要的 latest.json
const root = process.argv[2] ?? 'artifacts';
const owner = 'Lixin-2/apiTools';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tag = `v${pkg.version}`;

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

if (!fs.existsSync(root)) {
  console.error(`[latest.json] 目录不存在: ${root}`);
  process.exit(1);
}

const files = walk(root);
const url = (file) => `https://github.com/${owner}/releases/download/${tag}/${path.basename(file)}`;
const platforms = {};

for (const file of files) {
  const name = path.basename(file);
  if (name.endsWith('.app.tar.gz.sig')) {
    platforms['darwin-aarch64'] = {
      signature: fs.readFileSync(file, 'utf8').trim(),
      url: url(file.replace(/\.sig$/, '')),
    };
  } else if (name.endsWith('.nsis.zip.sig')) {
    platforms['windows-x86_64'] = {
      signature: fs.readFileSync(file, 'utf8').trim(),
      url: url(file.replace(/\.sig$/, '')),
    };
  }
}

if (!Object.keys(platforms).length) {
  console.error('[latest.json] 没有找到任何 .sig 更新包，检查是否配置了 TAURI_SIGNING_PRIVATE_KEY');
  process.exit(1);
}

const manifest = {
  version: pkg.version,
  notes: `apiTools ${pkg.version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync('latest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`[latest.json] version=${pkg.version} platforms=${Object.keys(platforms).join(',')}`);
