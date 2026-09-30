'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../shared/engine');

const snap = (fixtures, cues) => ({ fixtures, cues });
const F = (id, name = `F${id}`) => ({ id, name });

test('初始亮度为 0，无 Cue 时全程保持 0', () => {
  const s = snap([F(1)], []);
  assert.equal(engine.durationOf(s), 0);
  assert.equal(engine.levelsAt(s, 0)[1], 0);
  assert.equal(engine.levelsAt(s, 100)[1], 0);
});

test('duration=0 的 Cue 在触发时刻瞬变并保持', () => {
  const s = snap([F(1)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 5, target_level: 80, duration: 0 },
  ]);
  assert.equal(engine.durationOf(s), 5);
  assert.equal(engine.levelsAt(s, 4.999)[1], 0);
  assert.equal(engine.levelsAt(s, 5)[1], 80);
  assert.equal(engine.levelsAt(s, 99)[1], 80);
});

test('亮度随时间在触发时刻到目标之间线性渐变', () => {
  const s = snap([F(1)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 0, target_level: 100, duration: 10 },
  ]);
  assert.equal(engine.levelsAt(s, 0)[1], 0);
  assert.equal(engine.levelsAt(s, 2.5)[1], 25);
  assert.equal(engine.levelsAt(s, 5)[1], 50);
  assert.equal(engine.levelsAt(s, 10)[1], 100);
  assert.equal(engine.levelsAt(s, 20)[1], 100);
});

test('新 Cue 到达时从在途渐变的实际亮度折向新目标', () => {
  const s = snap([F(1)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 0, target_level: 100, duration: 10 },
    // t=5 时实际亮度 50，新目标 0、5 秒拉完 => t=10 时为 0
    { cue_no: 2, fixture_id: 1, trigger_time: 5, target_level: 0, duration: 5 },
  ]);
  assert.equal(engine.levelsAt(s, 4)[1], 40);
  assert.equal(engine.levelsAt(s, 5)[1], 50);
  assert.equal(engine.levelsAt(s, 7.5)[1], 25);
  assert.equal(engine.levelsAt(s, 10)[1], 0);
  assert.equal(engine.durationOf(s), 10);
});

test('同一时刻触发的多条 Cue 按 cue_no 升序依次生效', () => {
  const s = snap([F(1)], [
    // 先到 60（瞬变），紧接着从 60 用 2 秒升到 100
    { cue_no: 2, fixture_id: 1, trigger_time: 3, target_level: 100, duration: 2 },
    { cue_no: 1, fixture_id: 1, trigger_time: 3, target_level: 60, duration: 0 },
  ]);
  assert.equal(engine.levelsAt(s, 3)[1], 60);
  assert.equal(engine.levelsAt(s, 4)[1], 80);
  assert.equal(engine.levelsAt(s, 5)[1], 100);
});

test('同秒多条零时长 Cue：以编号最大者为准', () => {
  const s = snap([F(1)], [
    { cue_no: 3, fixture_id: 1, trigger_time: 2, target_level: 10, duration: 0 },
    { cue_no: 1, fixture_id: 1, trigger_time: 2, target_level: 70, duration: 0 },
    { cue_no: 2, fixture_id: 1, trigger_time: 2, target_level: 40, duration: 0 },
  ]);
  assert.equal(engine.levelsAt(s, 2)[1], 10);
  assert.equal(engine.levelsAt(s, 8)[1], 10);
});

test('不同灯具互不干扰，levelsAt 返回全部灯具', () => {
  const s = snap([F(1), F(2)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 0, target_level: 100, duration: 4 },
    { cue_no: 2, fixture_id: 2, trigger_time: 1, target_level: 30, duration: 1 },
  ]);
  const at2 = engine.levelsAt(s, 2);
  assert.equal(at2[1], 50);
  assert.equal(at2[2], 30);
});

test('新 Cue 在上一段渐变结束之后到达：亮度保持在已到达的目标上，不外推', () => {
  const s = snap([F(1)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 0, target_level: 100, duration: 2 },
    // t=2 已到 100 并保持；t=4 的新 Cue 应从 100 起步
    { cue_no: 2, fixture_id: 1, trigger_time: 4, target_level: 0, duration: 2 },
  ]);
  assert.equal(engine.levelsAt(s, 3)[1], 100);
  assert.equal(engine.levelsAt(s, 4)[1], 100);
  assert.equal(engine.levelsAt(s, 5)[1], 50);
});

test('异常输入下亮度仍被钳制在 0～100（兜底）', () => {
  const s = snap([F(1)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 0, target_level: 150, duration: 0 },
  ]);
  assert.equal(engine.levelsAt(s, 0)[1], 100);
});

test('负时间查询等同 t=0', () => {
  const s = snap([F(1)], [
    { cue_no: 1, fixture_id: 1, trigger_time: 0, target_level: 40, duration: 10 },
  ]);
  assert.equal(engine.levelsAt(s, -5)[1], 0);
});
