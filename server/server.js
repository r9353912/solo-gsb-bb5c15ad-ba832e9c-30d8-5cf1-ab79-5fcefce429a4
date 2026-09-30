'use strict';

const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const { createStore } = require('./store');
const { ValidationError } = require('./validate');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lx-cue.db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// 浏览器端复用同一份模拟引擎
app.use('/shared/engine.js', express.static(path.join(__dirname, '..', 'shared', 'engine.js')));

const db = openDb(DB_PATH);
const store = createStore(db);

const router = express.Router();

// 当前草稿：灯具 + Cue（可编辑）
router.get('/draft', (req, res) => {
  res.json(store.getDraft());
});

// 新增灯具
router.post('/draft/fixtures', (req, res) => {
  res.status(201).json(store.addFixture(req.body && req.body.name));
});

// 删除灯具（仍被 Cue 引用则拒绝）
router.delete('/draft/fixtures/:id', (req, res) => {
  res.json(store.deleteFixture(parseInt(req.params.id, 10)));
});

// 整批替换草稿 Cue —— 整次提交、整批校验，任一非法全部回滚
router.put('/draft/cues', (req, res) => {
  const cues = store.replaceCues(req.body && req.body.cues);
  res.json({ cues });
});

// 发布不可变演出版本
router.post('/versions', (req, res) => {
  const version = store.publish(req.body && req.body.note);
  res.status(201).json(version);
});

// 已发布版本列表（只追加）
router.get('/versions', (req, res) => {
  res.json({ versions: store.listVersions(), latest: store.latestVersionNo() });
});

// 取某个已发布版本的完整快照（播放端只读它）
router.get('/versions/:versionNo', (req, res) => {
  const no = parseInt(req.params.versionNo, 10);
  if (!Number.isInteger(no) || no <= 0) {
    throw Object.assign(new ValidationError('版本号必须是正整数'), { status: 404 });
  }
  res.json(store.getSnapshot(no));
});

router.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', router);

// JSON 体解析错误
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法 JSON' });
  }
  if (err instanceof ValidationError) {
    return res.status(err.status || 400).json({ error: err.message, details: err.details });
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`灯光 Cue 排演应用已启动: http://${HOST}:${PORT}  (DB: ${DB_PATH})`);
});

module.exports = { app, server, db };
