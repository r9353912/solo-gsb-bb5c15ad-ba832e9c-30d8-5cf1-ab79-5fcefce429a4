'use strict';

/**
 * 灯光模拟引擎（纯函数，Node 与浏览器共用）。
 *
 * 规则：
 *  - 所有灯具初始亮度 0。
 *  - 每个 Cue 是一段线性渐变：在 trigger_time 时刻，从“该时刻该灯的实际亮度”
 *    渐变到 target_level，时长 duration（非负秒数）。duration=0 即瞬变。
 *  - 新 Cue 到达时，同一灯正在进行的渐变立即从当前实际亮度折向新目标。
 *  - 同一秒（同一时刻）触发的 Cue 按 Cue 编号升序依次生效。
 *  - 亮度始终限制在 0～100（服务端已校验，引擎再做一次兜底钳制）。
 *
 * 输入 snapshot 形如：
 *   { fixtures: [{ id, name }], cues: [{ cue_no, fixture_id, trigger_time, target_level, duration }] }
 */

/** 把全部 Cue 展开为“事件”：(time, fixture, target, duration)，全局按 (time, cue_no) 排序。 */
function buildEvents(snapshot) {
  const events = (snapshot && Array.isArray(snapshot.cues) ? snapshot.cues : [])
    .map((c) => ({
      time: Number(c.trigger_time),
      fixtureId: c.fixture_id,
      target: Number(c.target_level),
      duration: Number(c.duration),
      cueNo: c.cue_no,
    }))
    .sort((a, b) => (a.time - b.time) || (a.cueNo - b.cueNo));
  return events;
}

/**
 * 计算指定灯具在时刻 t 的亮度。
 * 依次处理时间不晚于 t 的事件，维护“当前渐变段 {from, to, start, end}”。
 */
function levelAt(events, fixtureId, t) {
  let level = 0; // 初始亮度
  /** @type {{from:number,to:number,start:number,end:number}|null} */
  let seg = null;

  for (const e of events) {
    if (e.fixtureId !== fixtureId || e.time > t) {
      if (e.time > t) break; // 全局按 time 排序，后面的事件都晚于 t
      continue;
    }
    // 事件生效前一瞬间的实际亮度 = 上一段在 e.time 处的值
    // （若上一段早已结束，亮度已停在 to，钳制到段末，避免外推）
    const actual = seg
      ? seg.from +
        (seg.to - seg.from) *
          (Math.min(e.time, seg.end) - seg.start) / (seg.end - seg.start)
      : level;
    // 新 Cue 从实际亮度折向新目标
    seg = {
      from: actual,
      to: e.target,
      start: e.time,
      end: e.time + e.duration,
    };
    if (e.duration === 0) {
      // 瞬变：立刻抵达目标，之后保持
      level = e.target;
      seg = null;
    }
  }

  let value;
  if (!seg) {
    value = level;
  } else if (t >= seg.end) {
    value = seg.to;
  } else {
    value = seg.from + ((seg.to - seg.from) * (t - seg.start)) / (seg.end - seg.start);
  }
  return Math.max(0, Math.min(100, value));
}

/** 计算时刻 t 全部灯具的亮度：{ [fixtureId]: level }。 */
function levelsAt(snapshot, t) {
  const events = buildEvents(snapshot);
  const out = {};
  for (const f of snapshot.fixtures || []) {
    out[f.id] = levelAt(events, f.id, t);
  }
  return out;
}

/** 时间轴总时长（秒）：最后一个 Cue 的触发时刻 + 其渐变时长；无内容时为 0。 */
function durationOf(snapshot) {
  const events = buildEvents(snapshot);
  let max = 0;
  for (const e of events) {
    const end = e.time + e.duration;
    if (end > max) max = end;
  }
  return max;
}

/** 取某灯自己的事件序列（用于单元测试/可视化）。 */
function eventsOf(snapshot, fixtureId) {
  return buildEvents(snapshot).filter((e) => e.fixtureId === fixtureId);
}

const api = { buildEvents, levelAt, levelsAt, durationOf, eventsOf };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.LxEngine = api;
}
