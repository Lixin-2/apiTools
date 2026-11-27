import fs from 'node:fs';

// 把 GitHub Releases API 的原始响应精简成客户端直接可用的列表，
// 随 release 一起上传，客户端从 releases/latest/download/releases.json 读取，
// 避免每次都请求 api.github.com（国内很慢，还有 60 次/小时的限流）。
const inputPath = process.argv[2];
const version = process.argv[3];
const owner = 'Lixin-2/apiTools';

if (!inputPath || !fs.existsSync(inputPath)) {
  console.error(`[releases.json] 输入文件不存在: ${inputPath}`);
  process.exit(1);
}

let raw = [];
try {
  raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
} catch (err) {
  console.error(`[releases.json] 解析失败: ${err}`);
  process.exit(1);
}

if (!Array.isArray(raw)) {
  // API 被限流或返回错误对象时不要让整个发布流程失败，退化为只含当前版本
  console.warn('[releases.json] 输入不是数组（可能被限流），只写当前版本');
  raw = [];
}

const seen = new Set();
const list = [];

// 当前正在发布的版本在 API 结果里还不存在，手动补到最前面。
// body 直接复用刚生成的更新说明，否则应用内展开会显示为空。
let currentBody = '';
try {
  currentBody = fs.readFileSync('release-notes.md', 'utf8').trim();
} catch {
  currentBody = '';
}

if (version) {
  list.push({
    tag: `v${version}`,
    publishedAt: new Date().toISOString(),
    url: `https://github.com/${owner}/releases/tag/v${version}`,
    body: currentBody,
  });
  seen.add(`v${version}`);
}

for (const item of raw) {
  const tag = item.tag_name;
  if (!tag || seen.has(tag)) continue;
  seen.add(tag);
  list.push({
    tag,
    publishedAt: item.published_at ?? '',
    url: item.html_url,
    body: typeof item.body === 'string' ? item.body : '',
  });
}

fs.writeFileSync('releases.json', JSON.stringify(list, null, 2) + '\n');
console.log(`[releases.json] ${list.length} 个版本`);
