#!/usr/bin/env node
/**
 * 构建 client bundle：src/client-body.js + __ModuleLoader__ 包装 → lib/client.js。
 * 用法：
 *   node scripts/build-client.mjs           # 生成
 *   node scripts/build-client.mjs --check   # 校验生成物新鲜度（门禁用）
 *
 * 生成物勿手改——改 src/client-body.js 后重新构建。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bodyPath = path.join(root, 'src', 'client-body.js');
const outPath = path.join(root, 'lib', 'client.js');

const body = readFileSync(bodyPath, 'utf8').trimEnd();

const banner = `window.__ModuleLoader__.load({
  id: "dsh-model-caps",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
`;

const footer = `
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
`;

const output = `${banner}\n${body}\n${footer}`;

if (process.argv.includes('--check')) {
  const current = readFileSync(outPath, 'utf8');
  if (current !== output) {
    console.error('generated-freshness: lib/client.js 与 src/client-body.js 不同步——运行 node scripts/build-client.mjs');
    process.exit(1);
  }
  console.log('generated-freshness: ok');
  process.exit(0);
}

writeFileSync(outPath, output);
console.log(`built ${path.relative(root, outPath)} (${output.length} bytes)`);
