import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

test('browser source and production bundle contain no rule engine or secret fixture', async () => {
  const source = await readdir('apps/web/src');
  for (const file of source.filter((f) => /\.tsx?$/.test(f))) {
    const text = await readFile(`apps/web/src/${file}`, 'utf8');
    assert.doesNotMatch(
      text,
      /(?:from\s*|import\s*\()\s*['"][^'"]*(?:packages\/(?:engine|content)|server\/)/,
    );
  }
  const assets = await readdir('apps/web/dist/assets');
  for (const file of assets.filter((f) => f.endsWith('.js'))) {
    const text = await readFile(`apps/web/dist/assets/${file}`, 'utf8');
    assert.doesNotMatch(text, /复仇的火种|流言四起|compileOfficial|createSession|Ollama|Qwen/i);
  }
  const entry = await readFile('tragedy-test-ui.html', 'utf8');
  assert.doesNotMatch(entry, /review-token|127\.0\.0\.1:31177|\ufffd/);
  assert.match(entry, /<script>/);
  assert.doesNotMatch(entry, /<script[^>]+(?:src=|type="module")/);
});
