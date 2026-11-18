// 在 Node 里直接跑 TypeScript 源码（Node 24 原生类型剥离），
// 为客户端/store 依赖的浏览器全局补最小实现，供适配层与请求构造逻辑做单元验证。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve('D:/develop/github-project/deeplook/.scratch/build-env/src');

/** 把 `./x.js` 形式的导入解析到实际存在的 `.ts` / `.tsx` */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const base = path.resolve(path.dirname(new URL(context.parentURL).pathname.replace(/^\//, '')), specifier);
      for (const candidate of [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base]) {
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;
globalThis.window = globalThis;
globalThis.document = {
  visibilityState: 'visible',
  createElement: () => ({ style: {}, setAttribute() {}, removeAttribute() {} }),
  querySelector: () => null,
  body: { classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {} },
  documentElement: { style: {} },
  readyState: 'complete',
};
globalThis.__API_ORIGIN__ = 'https://api.deepseek.com';
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
try {
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
  }
} catch {
  // Node 已自带 navigator，无需覆盖
}
globalThis.matchMedia = globalThis.matchMedia || (() => ({
  matches: false, addEventListener() {}, removeEventListener() {},
}));

export { SRC, storage };
export const importSource = (relative) => import(pathToFileURL(path.join(SRC, relative)).href);

