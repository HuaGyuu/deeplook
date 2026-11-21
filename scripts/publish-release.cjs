// 用 GitHub REST API 配置仓库信息并发布 release（token 从环境变量 GH_TOKEN 读取，不打印）
// 用法：GH_TOKEN=... node scripts/publish-release.cjs dist/deeplook-1.4.2.apk v1.4.2 [dist/deeplook-1.4.2-diag.apk]
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const OWNER = 'HuaGyuu';
const REPO = 'deeplook';
const APK = process.argv[2];
const DIAG_APK = process.argv[4] && fs.existsSync(process.argv[4]) ? process.argv[4] : null;
const TAG = process.argv[3] || process.env.RELEASE_TAG || 'v1.4.2';
const VERSION = TAG.replace(/^v/, '');
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error('GH_TOKEN missing');
  process.exit(1);
}
if (!APK || !fs.existsSync(APK)) {
  console.error('APK missing');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'User-Agent': 'deeplook-release',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

const api = async (path, options = {}) => {
  const res = await fetch(`https://api.github.com${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, json, text };
};

/** 读 app/build.gradle 的版本信息，避免说明里手写 versionCode 出错 */
const readVersionInfo = () => {
  const gradle = fs.readFileSync(path.join(__dirname, '..', 'app', 'build.gradle'), 'utf8');
  const code = /versionCode\s+(\d+)/.exec(gradle);
  const name = /versionName\s+['"]([^'"]+)['"]/.exec(gradle);
  return { versionCode: code ? code[1] : '', versionName: name ? name[1] : VERSION };
};

/** 只取 CHANGELOG 里当前版本的小节，历史说明交给 CHANGELOG 与 Releases 列表 */
const readChangelogSection = (version) => {
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const lines = changelog.split(/\r?\n/);
  const header = `## ${version}`;
  const from = lines.findIndex((line) => line.trim() === header);
  if (from < 0) {
    return [];
  }
  const items = [];
  for (const line of lines.slice(from + 1)) {
    if (/^##\s/.test(line.trim())) {
      break;
    }
    const text = line.trim();
    if (text.startsWith('- ')) {
      items.push(text);
    }
  }
  return items;
};

const releaseNotes = (sha256, sizeMb) => {
  const { versionCode, versionName } = readVersionInfo();
  const changes = readChangelogSection(versionName);
  return [
    `## DeepLook ${TAG}`,
    '',
    '基于 DeepSeek 官方 API 的安卓聊天客户端（WebView + React/TypeScript）。',
    '',
    '### 本次更新',
    ...(changes.length > 0 ? changes : [`- 版本 ${versionName}`]),
    '',
    '### 安装',
    `下载下方 \`deeplook-${VERSION}.apk\` 安装（需允许未知来源），首次打开到 **设置 → 数据管理** 填入 DeepSeek API Key。`,
    ...(DIAG_APK
      ? ['', `> 排查问题用的调试版：\`deeplook-${VERSION}-diag.apk\`（启动时会显示加载进度与诊断信息，功能与正式版一致）。`]
      : []),
    '',
    '### 说明',
    `- 版本：${versionName}（versionCode ${versionCode}）`,
    '- 包名：`com.huagyuu.deeplook`',
    `- 大小：${sizeMb} MB`,
    `- SHA-256：\`${sha256}\``,
    '- Release APK 使用 debug 签名，便于直接安装体验；上架请自行替换正式签名。',
    '',
    '完整更新记录见 [CHANGELOG.md](https://github.com/HuaGyuu/deeplook/blob/main/CHANGELOG.md)。',
  ].join('\n');
};

(async () => {
  const apk = fs.readFileSync(APK);
  const sha256 = crypto.createHash('sha256').update(apk).digest('hex');
  const sizeMb = (apk.length / 1048576).toFixed(2);

  // 仓库描述 / 主页
  const patch = await api(`/repos/${OWNER}/${REPO}`, {
    method: 'PATCH',
    body: JSON.stringify({
      description: 'DeepLook — 基于 DeepSeek 官方 API 的 Android 聊天客户端（WebView + React/TypeScript）',
      homepage: `https://github.com/${OWNER}/${REPO}`,
      has_issues: true,
      has_wiki: false,
    }),
  });
  console.log('repo patch:', patch.status, patch.json?.description);

  // topics
  const topics = await api(`/repos/${OWNER}/${REPO}/topics`, {
    method: 'PUT',
    body: JSON.stringify({
      names: ['android', 'deepseek', 'chatbot', 'webview', 'react', 'typescript', 'ai'],
    }),
  });
  console.log('topics:', topics.status, JSON.stringify(topics.json?.names));

  const body = releaseNotes(sha256, sizeMb);

  // 创建或更新 release
  let release = await api(`/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  if (release.status === 404) {
    release = await api(`/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: TAG,
        target_commitish: 'main',
        name: `DeepLook ${TAG}`,
        body,
        draft: false,
        prerelease: false,
        make_latest: 'true',
      }),
    });
  } else if (release.status === 200) {
    release = await api(`/repos/${OWNER}/${REPO}/releases/${release.json.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: `DeepLook ${TAG}`, body, make_latest: 'true' }),
    });
  }
  if (!release.json?.id) {
    console.error('release failed:', release.status, release.text.slice(0, 300));
    process.exit(1);
  }
  console.log('release:', release.status, release.json.html_url);

  // 上传 APK 资产（同名旧资产先删除）
  const assets = await api(`/repos/${OWNER}/${REPO}/releases/${release.json.id}/assets`);
  const name = `deeplook-${VERSION}.apk`;
  const existing = assets.json?.find?.((item) => item.name === name);
  if (existing) {
    await api(`/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, { method: 'DELETE' });
  }
  const upload = await fetch(
    `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.json.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/vnd.android.package-archive' },
      body: apk,
    }
  );
  const uploaded = await upload.json();
  console.log('asset:', upload.status, uploaded.browser_download_url, `${sizeMb} MB`);
  console.log('sha256:', sha256);

  // 调试版 APK（可选）：单独资产，便于让用户装同一个版本抓启动信息
  if (DIAG_APK) {
    const diagBuffer = fs.readFileSync(DIAG_APK);
    const diagSha = crypto.createHash('sha256').update(diagBuffer).digest('hex');
    const diagSizeMb = (diagBuffer.length / 1048576).toFixed(2);
    const diagName = `deeplook-${VERSION}-diag.apk`;
    const diagExisting = assets.json?.find?.((item) => item.name === diagName);
    if (diagExisting) {
      await api(`/repos/${OWNER}/${REPO}/releases/assets/${diagExisting.id}`, { method: 'DELETE' });
    }
    const diagUpload = await fetch(
      `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.json.id}/assets?name=${encodeURIComponent(diagName)}`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/vnd.android.package-archive' },
        body: diagBuffer,
      }
    );
    const diagUploaded = await diagUpload.json();
    console.log('diag asset:', diagUpload.status, diagUploaded.browser_download_url, `${diagSizeMb} MB`);
    console.log('diag sha256:', diagSha);
  }
})().catch((error) => {
  console.error('FAILED', error.message);
  process.exit(1);
});









