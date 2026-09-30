'use strict';

/**
 * 校验规则集中管理。任何一条非法都抛出 ValidationError，
 * 由调用方在数据库事务内拒绝“整次提交”（事务回滚）。
 */

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.details = details || null;
  }
}

/**
 * 仅接受有限数字（或可转成数字的非空字符串），
 * 拒绝 NaN/Infinity/布尔/null/undefined/对象/空串。
 * 注意：JSON 中溢出的 1e999 会被解析为 null，必须显式拒绝
 * （否则 Number(null)===0 会被误当成合法的 0）。
 */
function finiteNumber(v, field) {
  if (typeof v === 'boolean' || v === null || v === undefined) {
    throw new ValidationError(`字段 ${field} 必须是数字，收到：${JSON.stringify(v)}`);
  }
  if (typeof v === 'object') {
    throw new ValidationError(`字段 ${field} 必须是数字，收到：对象/数组`);
  }
  if (typeof v === 'string' && v.trim() === '') {
    throw new ValidationError(`字段 ${field} 不能为空`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`字段 ${field} 必须是有限数字，收到：${JSON.stringify(v)}`);
  }
  return n;
}

/** 非负秒数。 */
function nonNegSeconds(v, field) {
  const n = finiteNumber(v, field);
  if (n < 0) {
    throw new ValidationError(`字段 ${field} 必须是非负秒数，收到：${n}`);
  }
  return n;
}

/** 正整数 Cue 编号。 */
function cueNo(v, field = 'cue_no') {
  if (typeof v === 'boolean') {
    throw new ValidationError(`字段 ${field} 必须是正整数`);
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ValidationError(`字段 ${field} 必须是正整数，收到：${JSON.stringify(v)}`);
  }
  return n;
}

/** 亮度 0～100。 */
function level0to100(v, field = 'target_level') {
  const n = finiteNumber(v, field);
  if (n < 0 || n > 100) {
    throw new ValidationError(`字段 ${field} 必须在 0～100 之间，收到：${n}`);
  }
  return n;
}

function trimName(v) {
  if (typeof v !== 'string') {
    throw new ValidationError('灯具名称必须是字符串');
  }
  const name = v.trim();
  if (!name) {
    throw new ValidationError('灯具名称不能为空');
  }
  if (name.length > 64) {
    throw new ValidationError('灯具名称最长 64 个字符');
  }
  return name;
}

/** 校验一整批 Cue，返回规整后的行；任何一条非法即抛出（整批拒绝）。 */
function validateCueBatch(rows, fixtureIds) {
  if (!Array.isArray(rows)) {
    throw new ValidationError('请求体 cues 必须是数组（整批替换草稿 Cue）');
  }
  const fset = new Set(fixtureIds);
  const seen = new Set();
  return rows.map((row, i) => {
    const at = `cues[${i}]`;
    if (!row || typeof row !== 'object') {
      throw new ValidationError(`${at} 必须是对象`);
    }
    const no = cueNo(row.cue_no);
    if (seen.has(no)) {
      throw new ValidationError(`${at} Cue 编号 ${no} 在本次提交中重复`);
    }
    seen.add(no);

    const fid = Number(row.fixture_id);
    if (!Number.isInteger(fid) || !fset.has(fid)) {
      throw new ValidationError(`${at} 引用了未知灯具 fixture_id=${JSON.stringify(row.fixture_id)}`);
    }
    const triggerTime = nonNegSeconds(row.trigger_time, `${at}.trigger_time`);
    const targetLevel = level0to100(row.target_level, `${at}.target_level`);
    const duration = nonNegSeconds(row.duration, `${at}.duration`);

    return { cue_no: no, fixture_id: fid, trigger_time: triggerTime, target_level: targetLevel, duration };
  });
}

module.exports = {
  ValidationError,
  finiteNumber,
  nonNegSeconds,
  cueNo,
  level0to100,
  trimName,
  validateCueBatch,
};
