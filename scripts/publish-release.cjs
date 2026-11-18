// 用 GitHub REST API 配置仓库信息并发布 release（token 从环境变量 GH_TOKEN 读取，不打印）
// 用法：GH_TOKEN=... node scripts/publish-release.cjs dist/deeplook-1.4.2.apk v1.4.2
const fs = require('node:fs');
const crypto = require('node:crypto');

const OWNER = 'HuaGyuu';
const REPO = 'deeplook';
const APK = process.argv[2];
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

const releaseNotes = (sha256, sizeMb) => [
  `## deeplook ${TAG}`,
  '',
  '基于 DeepSeek 官方 API 的安卓聊天客户端（WebView + React/TypeScript）。',
  '',
  '### 本次更新',
  '- 关于页新增作者 HuaGyuu、GitHub 仓库、问题反馈、MIT 协议与技术栈信息',
  '- 修复设置二级页面按系统返回键直接退出设置：现在先回到设置首页，再按一次退出',
  '- 修复聊天背景预览与真实背景不一致：实际背景层补上居中定位，裁剪框和预览跟随设备视口比例',
  '- 裁剪界面增加整图暗色底图，框外可看到完整图片，框内为实际选区',
  '- 修复宽图裁剪界面被裁成窄条：现在完整显示原图，并用 canvas 裁剪框内区域，实际背景与预览一致',
  '- 修复设置首页关于条目版本号写死 1.4.1：统一由 APP_VERSION 常量提供',
  '- 修复语音输入：录音前先向原生申请麦克风权限；AudioContext 不支持 16k 时回退并重采样为 16k',
  '- 修复语音仍失败：补充 MODIFY_AUDIO_SETTINGS 权限（Chromium WebView 录音同时需要 RECORD_AUDIO 和 MODIFY_AUDIO_SETTINGS）',
  '',
  '### 安装',
  `下载下方 \`deeplook-${VERSION}.apk\` 安装（需允许未知来源），首次打开到 **设置 → 数据管理** 填入 DeepSeek API Key。`,
  '',
  '### 说明',
  `- 版本：${VERSION}（versionCode 10）`,
  '- 包名：`com.deepseek.chatdemo`',
  `- 大小：${sizeMb} MB`,
  `- SHA-256：\`${sha256}\``,
  '- Release APK 使用 debug 签名，便于直接安装体验；上架请自行替换正式签名。',
  '',
  '完整更新记录见 [CHANGELOG.md](https://github.com/HuaGyuu/deeplook/blob/main/CHANGELOG.md)。',
].join('\n');

(async () => {
  const apk = fs.readFileSync(APK);
  const sha256 = crypto.createHash('sha256').update(apk).digest('hex');
  const sizeMb = (apk.length / 1048576).toFixed(2);

  // 仓库描述 / 主页
  const patch = await api(`/repos/${OWNER}/${REPO}`, {
    method: 'PATCH',
    body: JSON.stringify({
      description: 'deeplook — 基于 DeepSeek 官方 API 的 Android 聊天客户端（WebView + React/TypeScript）',
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
        name: `deeplook ${TAG}`,
        body,
        draft: false,
        prerelease: false,
        make_latest: 'true',
      }),
    });
  } else if (release.status === 200) {
    release = await api(`/repos/${OWNER}/${REPO}/releases/${release.json.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: `deeplook ${TAG}`, body, make_latest: 'true' }),
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
})().catch((error) => {
  console.error('FAILED', error.message);
  process.exit(1);
});


