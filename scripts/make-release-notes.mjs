import { execSync } from 'node:child_process';
import fs from 'node:fs';

// 从两个 tag 之间的提交生成中文更新说明，作为 GitHub Release 正文。
// 输出格式（供应用内更新日志渲染）：
//   ### 新功能
//   - xxx
//   ### 问题修复
//   - xxx
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = process.argv[2] ?? pkg.version;
const currentTag = `v${version}`;

let previousTag = '';
try {
  const tags = execSync('git tag --sort=-v:refname', { encoding: 'utf8' })
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item && item !== currentTag);
  previousTag = tags[0] ?? '';
} catch {
  previousTag = '';
}

const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
let subjects = [];
try {
  subjects = execSync(`git log ${range} --pretty=format:%s`, { encoding: 'utf8' })
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
} catch {
  subjects = [];
}

const feat = [];
const improve = [];
const fix = [];
const other = [];

for (const subject of subjects) {
  if (/^feat(\([^)]*\))?!?:/i.test(subject)) {
    feat.push(subject.replace(/^feat(\([^)]*\))?!?:\s*/i, ''));
  } else if (/^fix(\([^)]*\))?!?:/i.test(subject)) {
    fix.push(subject.replace(/^fix(\([^)]*\))?!?:\s*/i, ''));
  } else if (/^(perf|refactor|style|improve)(\([^)]*\))?!?:/i.test(subject)) {
    improve.push(subject.replace(/^(perf|refactor|style|improve)(\([^)]*\))?!?:\s*/i, ''));
  } else if (/^(chore|ci|docs|test|build)(\([^)]*\))?!?:/i.test(subject)) {
    // 工程杂项不进更新说明
  } else {
    other.push(subject);
  }
}

const lines = [];
if (feat.length) {
  lines.push('### 新功能', ...feat.map((item) => `- ${item}`), '');
}
if (improve.length) {
  lines.push('### 改进', ...improve.map((item) => `- ${item}`), '');
}
if (fix.length) {
  lines.push('### 问题修复', ...fix.map((item) => `- ${item}`), '');
}
if (other.length) {
  lines.push('### 其他', ...other.map((item) => `- ${item}`), '');
}

const body = lines.join('\n').trim();
fs.writeFileSync('release-notes.md', (body || `apiTools ${version}`) + '\n');
console.log(
  `[release-notes] ${previousTag || '(首个版本)'} → ${currentTag}：` +
    `新功能 ${feat.length} / 改进 ${improve.length} / 修复 ${fix.length}`,
);
