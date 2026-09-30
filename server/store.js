'use strict';

const {
  ValidationError,
  trimName,
  validateCueBatch,
} = require('./validate');

/**
 * 数据访问 + 业务规则层。所有写操作都包在 better-sqlite3 事务里：
 * 校验失败即抛错并回滚，保证“拒绝整次提交”，绝不留下半成品。
 */
function createStore(db) {
  const q = {
    fixtures: db.prepare('SELECT id, name FROM fixtures ORDER BY id'),
    cues: db.prepare(
      'SELECT cue_no, fixture_id, trigger_time, target_level, duration FROM cues ORDER BY cue_no'
    ),
    fixtureById: db.prepare('SELECT id, name FROM fixtures WHERE id = ?'),
    fixtureByName: db.prepare('SELECT id, name FROM fixtures WHERE name = ?'),
    cueRefsOfFixture: db.prepare('SELECT COUNT(*) AS n FROM cues WHERE fixture_id = ?'),
    insertFixture: db.prepare('INSERT INTO fixtures (name) VALUES (?)'),
    deleteFixture: db.prepare('DELETE FROM fixtures WHERE id = ?'),
    clearCues: db.prepare('DELETE FROM cues'),
    insertCue: db.prepare(
      'INSERT INTO cues (cue_no, fixture_id, trigger_time, target_level, duration) VALUES (?, ?, ?, ?, ?)'
    ),
    maxVersionNo: db.prepare('SELECT COALESCE(MAX(version_no), 0) AS n FROM versions'),
    insertVersion: db.prepare('INSERT INTO versions (version_no, note) VALUES (?, ?)'),
    insertVFixture: db.prepare(
      'INSERT INTO version_fixtures (version_id, fixture_ref_id, name) VALUES (?, ?, ?)'
    ),
    insertVCue: db.prepare(
      `INSERT INTO version_cues
         (version_id, cue_no, fixture_ref_id, trigger_time, target_level, duration)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    versions: db.prepare(
      'SELECT id, version_no, note, created_at FROM versions ORDER BY version_no DESC'
    ),
    versionByNo: db.prepare(
      'SELECT id, version_no, note, created_at FROM versions WHERE version_no = ?'
    ),
    vFixtures: db.prepare(
      'SELECT fixture_ref_id AS id, name FROM version_fixtures WHERE version_id = ? ORDER BY fixture_ref_id'
    ),
    vCues: db.prepare(
      `SELECT cue_no, fixture_ref_id AS fixture_id, trigger_time, target_level, duration
         FROM version_cues WHERE version_id = ? ORDER BY trigger_time, cue_no`
    ),
  };

  function getDraft() {
    return { fixtures: q.fixtures.all(), cues: q.cues.all() };
  }

  const addFixture = db.transaction((rawName) => {
    const name = trimName(rawName);
    if (q.fixtureByName.get(name)) {
      const err = new ValidationError(`灯具名称 “${name}” 已存在`);
      err.status = 409;
      throw err;
    }
    const info = q.insertFixture.run(name);
    return q.fixtureById.get(info.lastInsertRowid);
  });

  const deleteFixture = db.transaction((id) => {
    const fixture = q.fixtureById.get(id);
    if (!fixture) {
      const err = new ValidationError(`未知灯具 id=${id}`);
      err.status = 404;
      throw err;
    }
    const refs = q.cueRefsOfFixture.get(id).n;
    if (refs > 0) {
      const err = new ValidationError(`灯具 “${fixture.name}” 仍被 ${refs} 条 Cue 引用，不能删除`);
      err.status = 409;
      throw err;
    }
    q.deleteFixture.run(id);
    return { id };
  });

  /** 整批替换草稿 Cue（事务）：任意一行非法 -> 全部不生效。 */
  const replaceCues = db.transaction((rows) => {
    const fixtures = q.fixtures.all();
    const normalized = validateCueBatch(rows, fixtures.map((f) => f.id));
    q.clearCues.run();
    for (const c of normalized) {
      q.insertCue.run(c.cue_no, c.fixture_id, c.trigger_time, c.target_level, c.duration);
    }
    return q.cues.all();
  });

  /**
   * 发布不可变演出版本：把当前草稿完整快照进 version_* 表。
   * 快照一旦写入永不修改；草稿之后怎么改都不影响任何已发布版本。
   */
  const publish = db.transaction((note) => {
    if (typeof note !== 'string') note = '';
    if (note.length > 200) throw new ValidationError('备注最长 200 字');

    const fixtures = q.fixtures.all();
    const cues = q.cues.all();
    const versionNo = q.maxVersionNo.get().n + 1;
    const info = q.insertVersion.run(versionNo, note.trim());
    const versionId = info.lastInsertRowid;
    for (const f of fixtures) q.insertVFixture.run(versionId, f.id, f.name);
    for (const c of cues) {
      q.insertVCue.run(versionId, c.cue_no, c.fixture_id, c.trigger_time, c.target_level, c.duration);
    }
    return q.versionByNo.get(versionNo);
  });

  function listVersions() {
    return q.versions.all();
  }

  function getSnapshot(versionNo) {
    const version = q.versionByNo.get(versionNo);
    if (!version) {
      const err = new ValidationError(`未知版本号 v${versionNo}`);
      err.status = 404;
      throw err;
    }
    return {
      version: {
        version_no: version.version_no,
        note: version.note,
        created_at: version.created_at,
      },
      fixtures: q.vFixtures.all(version.id),
      cues: q.vCues.all(version.id),
    };
  }

  function latestVersionNo() {
    const row = q.maxVersionNo.get();
    return row.n > 0 ? row.n : null;
  }

  return {
    getDraft,
    addFixture,
    deleteFixture,
    replaceCues,
    publish,
    listVersions,
    getSnapshot,
    latestVersionNo,
  };
}

module.exports = { createStore };
