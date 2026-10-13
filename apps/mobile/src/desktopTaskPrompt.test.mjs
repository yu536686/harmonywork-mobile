import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopTaskPrompt } from './desktopTaskPrompt.ts';

test('desktop task keeps the original file delivery request when planning only asks to search', () => {
  const original = '把桌面上的那个太原三日游攻略的文档发给我';
  const planned = '在 Windows 桌面查找太原三日游攻略，返回路径和完整内容';
  const prompt = desktopTaskPrompt(planned, original);
  assert.match(prompt, /把桌面上的那个太原三日游攻略的文档发给我/);
  assert.match(prompt, /在 Windows 桌面查找太原三日游攻略/);
  assert.ok(prompt.indexOf(original) < prompt.indexOf(planned));
});

test('desktop task preserves a maximum-length original request within the task limit', () => {
  const original = '发'.repeat(8_000);
  const prompt = desktopTaskPrompt('查找文件', original);
  assert.equal(prompt, original);
  assert.equal([...prompt].length, 8_000);
});
