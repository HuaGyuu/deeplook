// 单元验证：
// 1) 连接固定为 DeepSeek 官方 + deepseek-flash
// 2) 默认 Key 校验请求根路径 /models
// 3) OpenAI 兼容适配层（保留能力）仍能把分片翻译成内部事件
import assert from 'node:assert/strict';
import http from 'node:http';
import { storage, importSource } from './setup.mjs';

const { verifyApiKey, API_ORIGIN } = await importSource('services/api/client.ts');
const { getConnection } = await importSource('services/providers.ts');
const { streamOpenAiMessage } = await importSource('services/api/openai.ts');

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
};

// 1. 固定连接
check('固定为 DeepSeek 官方 + deepseek-flash', () => {
  const c = getConnection();
  assert.equal(c.provider, 'deepseek');
  assert.equal(c.endpoint, '');
  assert.equal(c.model, 'deepseek-flash');
  assert.equal(c.isDeepSeek, true);
  assert.equal(API_ORIGIN, 'https://api.deepseek.com');
});

// 2. Key 校验地址
{
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: init?.headers ?? {} };
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await verifyApiKey('sk-deepseek-key');
    check('Key 校验请求 https://api.deepseek.com/models', () =>
      assert.equal(captured.url, 'https://api.deepseek.com/models')
    );
    check('Key 校验使用 Bearer', () =>
      assert.equal(captured.headers.Authorization, 'Bearer sk-deepseek-key')
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 3. OpenAI 兼容适配层
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ id: 'chatcmpl-1', model: 'gpt-4.1', choices: [{ index: 0, delta: { role: 'assistant' } }] });
    send({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { reasoning_content: '先想一想。' } }] });
    send({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: '你好，' } }] });
    send({ id: 'chatcmpl-1', choices: [{ index: 0, delta: { content: '世界！' } }] });
    send({ id: 'chatcmpl-1', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const events = [];
for await (const event of streamOpenAiMessage(
  `http://127.0.0.1:${port}/v1`,
  'sk-test',
  {
    model: 'gpt-4.1',
    system: 'system',
    messages: [
      { role: 'user', content: '问' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '旧思考', signature: 's' }, { type: 'text', text: '答' }] },
      { role: 'user', content: '再问' },
    ],
    thinking: { type: 'enabled' },
    tools: [],
    safety_check: { level: 'high' },
  },
  'gpt-4.1',
  new AbortController().signal
)) {
  events.push(event);
}

check('OpenAI 适配层翻译正文与思考', () => {
  const text = events
    .filter((e) => e.type === 'content_block_delta' && e.delta.type === 'text_delta')
    .map((e) => e.delta.text)
    .join('');
  const thinking = events
    .filter((e) => e.type === 'content_block_delta' && e.delta.type === 'thinking_delta')
    .map((e) => e.delta.thinking)
    .join('');
  assert.equal(text, '你好，世界！');
  assert.equal(thinking, '先想一想。');
  const delta = events.find((e) => e.type === 'message_delta');
  assert.equal(delta.delta.stop_reason, 'max_tokens');
  assert.equal(events.at(-1).type, 'message_stop');
});

console.log(results.join('\n'));
server.close();
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASSED');
process.exit(failed.length ? 1 : 0);
