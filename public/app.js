'use strict';
/* global LxEngine */

// ---------- 小工具 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 3000);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- 全局状态 ----------
const state = {
  draft: { fixtures: [], cues: [] },
  versions: [],
  snapshot: null,          // 当前选中（未锁定）版本的快照
  editorRows: [], // {cue_no, fixture_id, trigger_time, target_level, duration} 均为字符串
  // 播放相关
  selectedVersionNo: null, // 下拉选择（尚未开始）
  session: null,           // { versionNo, snapshot, duration } —— 一旦开始即锁定
  playing: false,
  time: 0,
  rafId: null,
  rafStartWall: 0,
  rafStartTime: 0,
};

// ---------- Tab 切换 ----------
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    const name = btn.dataset.tab;
    $$('.tabpanel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
    if (name === 'fixtures' || name === 'cues') loadDraft();
    if (name === 'versions') loadVersions();
  });});

// ==================== 灯具 ====================
async function loadDraft() {
  const hadEditorRows = state.editorRows.length > 0;
  state.draft = await api('GET', '/api/draft');
  renderFixtures();
  if (hadEditorRows) {
    // 用户可能正在编辑 Cue（例如切去「灯具」页新增了一盏灯）：
    // 保留已输入的行值，仅重绘以刷新灯具下拉，不吞掉未保存的修改。
    renderCueEditor();
  } else {
    syncEditorWithDraft();
  }
}

function renderFixtures() {
  const tbody = $('#fixture-table tbody');
  if (!state.draft.fixtures.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="3">还没有灯具，请先添加。</td></tr>';
  } else {
    tbody.innerHTML = state.draft.fixtures.map((f) => `
      <tr>
        <td class="num">${f.id}</td>
        <td>${esc(f.name)}</td>
        <td><button class="danger" data-del-fixture="${f.id}">删除</button></td>
      </tr>`).join('');
  }
}

$('#form-fixture').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#fixture-name');
  const name = input.value;
  try {
    await api('POST', '/api/draft/fixtures', { name });
    input.value = '';
    await loadDraft();
    toast('灯具已添加', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#fixture-table tbody').addEventListener('click', async (e) => {
  const id = e.target.dataset.delFixture;
  if (!id) return;
  if (!confirm('确认删除该灯具？')) return;
  try {
    await api('DELETE', `/api/draft/fixtures/${id}`);
    await loadDraft();
    toast('灯具已删除', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ==================== 草稿 Cue 编辑器 ====================
function syncEditorWithDraft() {
  // 仅在用户未手动改动过行时用草稿覆盖；简单起见：加载草稿时总是同步
  state.editorRows = state.draft.cues.map((c) => ({
    cue_no: String(c.cue_no),
    fixture_id: String(c.fixture_id),
    trigger_time: String(c.trigger_time),
    target_level: String(c.target_level),
    duration: String(c.duration),
  }));
  renderCueEditor();
}

function fixtureOptions(selected) {
  if (!state.draft.fixtures.length) return '<option value="">（请先添加灯具）</option>';
  return state.draft.fixtures
    .map((f) => `<option value="${f.id}"${String(f.id) === String(selected) ? ' selected' : ''}>${f.id} · ${esc(f.name)}</option>`)
    .join('');
}

function renderCueEditor() {
  const tbody = $('#cue-table tbody');
  if (!state.editorRows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">没有 Cue，点「新增一行」开始编排。</td></tr>';
    return;
  }
  tbody.innerHTML = state.editorRows.map((r, i) => `
    <tr data-row="${i}">
      <td><input data-field="cue_no" type="number" min="1" step="1" value="${esc(r.cue_no)}" /></td>
      <td><select data-field="fixture_id"><option value="">选择灯具…</option>${fixtureOptions(r.fixture_id)}</select></td>
      <td><input data-field="trigger_time" type="number" min="0" step="0.1" value="${esc(r.trigger_time)}" /></td>
      <td><input data-field="target_level" type="number" min="0" max="100" step="0.1" value="${esc(r.target_level)}" /></td>
      <td><input data-field="duration" type="number" min="0" step="0.1" value="${esc(r.duration)}" /></td>
      <td><button class="danger" data-del-row="${i}">移除</button></td>
    </tr>`).join('');
}

$('#cue-table tbody').addEventListener('input', (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const tr = e.target.closest('tr');
  const i = Number(tr.dataset.row);
  state.editorRows[i][field] = e.target.value;
  tr.classList.remove('invalid');
  const errEl = tr.querySelector('.row-error');
  if (errEl) errEl.remove();
});

$('#cue-table tbody').addEventListener('click', (e) => {
  const idx = e.target.dataset.delRow;
  if (idx === undefined) return;
  state.editorRows.splice(Number(idx), 1);
  renderCueEditor();
});

$('#btn-add-cue').addEventListener('click', async () => {
  if (!state.draft.fixtures.length) {
    toast('请先在「灯具」页添加灯具', 'error');
    return;
  }
  const nextNo = state.editorRows.reduce((m, r) => Math.max(m, Number(r.cue_no) || 0), 0) + 1;
  state.editorRows.push({
    cue_no: String(nextNo),
    fixture_id: String(state.draft.fixtures[0].id),
    trigger_time: '0',
    target_level: '50',
    duration: '1',
  });
  renderCueEditor();
});

$('#btn-clear-cues').addEventListener('click', () => {
  if (state.editorRows.length && !confirm('确认清空全部草稿 Cue？')) return;
  state.editorRows = [];
  renderCueEditor();
});

// 前端先做一遍提示，真正的整批校验由服务端完成（权威）
function clientValidate(rows) {
  const seen = new Set();
  rows.forEach((r, i) => {
    const errs = [];
    const no = Number(r.cue_no);
    if (!Number.isInteger(no) || no <= 0) errs.push('Cue 编号必须是正整数');
    else if (seen.has(no)) errs.push(`编号 ${no} 重复`);
    else seen.add(no);

    if (!state.draft.fixtures.some((f) => String(f.id) === r.fixture_id)) errs.push('未知灯具');

    const tt = Number(r.trigger_time);
    if (!Number.isFinite(tt) || tt < 0) errs.push('触发时刻须为非负数');

    const lv = Number(r.target_level);
    if (!Number.isFinite(lv) || lv < 0 || lv > 100) errs.push('亮度须为 0～100');

    const du = Number(r.duration);
    if (!Number.isFinite(du) || du < 0) errs.push('渐变时长须为非负数');

    if (errs.length) {
      const tr = $(`#cue-table tbody tr[data-row="${i}"]`);
      if (tr) {
        tr.classList.add('invalid');
        const td = tr.querySelector('td:last-child');
        const div = document.createElement('div');
        div.className = 'row-error';
        div.textContent = errs.join('；');
        td.appendChild(div);
      }
    }
  });
}

$('#btn-save-cues').addEventListener('click', async () => {
  // 清掉旧错误标记
  $$('#cue-table tbody tr.invalid').forEach((tr) => tr.classList.remove('invalid'));
  $$('#cue-table tbody .row-error').forEach((el) => el.remove());

  const payload = state.editorRows.map((r) => ({
    cue_no: r.cue_no,
    fixture_id: r.fixture_id,
    trigger_time: r.trigger_time,
    target_level: r.target_level,
    duration: r.duration,
  }));

  try {
    const data = await api('PUT', '/api/draft/cues', { cues: payload });
    state.draft.cues = data.cues;
    syncEditorWithDraft();
    $('#cue-save-status').textContent = `✓ 已保存 ${data.cues.length} 条 Cue（${new Date().toLocaleTimeString()}）`;
    toast('草稿 Cue 已整批保存', 'ok');
  } catch (err) {
    toast(`整次提交被拒绝：\n${err.message}`, 'error');
    // 前端再标注一遍便于定位
    clientValidate(state.editorRows);
  }
});

// ==================== 版本 ====================
async function loadVersions() {
  const data = await api('GET', '/api/versions');
  state.versions = data.versions;
  renderVersionTable();
  renderVersionSelect();
}

function renderVersionTable() {
  const tbody = $('#version-table tbody');
  if (!state.versions.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">尚未发布任何版本。编辑好草稿后点上方按钮发布。</td></tr>';
    return;
  }
  tbody.innerHTML = state.versions.map((v) => `
    <tr>
      <td class="num"><strong>v${v.version_no}</strong></td>
      <td>${esc(v.note || '—')}</td>
      <td class="num">${esc(v.created_at)}</td>
      <td class="num" id="vcount-${v.version_no}">…</td>
      <td><button data-load-version="${v.version_no}">在播放器打开</button></td>
    </tr>`).join('');

  // 拉取每个版本的灯具/Cue 数量
  state.versions.forEach(async (v) => {
    try {
      const snap = await api('GET', `/api/versions/${v.version_no}`);
      const cell = $(`#vcount-${v.version_no}`);
      if (cell) cell.textContent = `${snap.fixtures.length} / ${snap.cues.length}`;
    } catch { /* 忽略统计失败 */ }
  });
}

$('#version-table tbody').addEventListener('click', async (e) => {
  const no = e.target.dataset.loadVersion;
  if (!no) return;
  await selectVersion(Number(no));
  $('.tab[data-tab="player"]').click();
});

$('#form-publish').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const v = await api('POST', '/api/versions', { note: $('#publish-note').value });
    $('#publish-note').value = '';
    toast(`已发布不可变版本 v${v.version_no}`, 'ok');
    await loadVersions();
    // 若当前没有排演会话，自动切到新版本；有会话则绝不动它（在播结果不变）
    if (!state.session) await selectVersion(v.version_no);
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ==================== 播放器 ====================
function renderVersionSelect() {
  const sel = $('#version-select');
  if (!state.versions.length) {
    sel.innerHTML = '<option value="">（无已发布版本，请先发布）</option>';
    state.selectedVersionNo = null;
  } else {
    sel.innerHTML = state.versions
      .map((v) => `<option value="${v.version_no}"${v.version_no === state.selectedVersionNo ? ' selected' : ''}>v${v.version_no}${v.note ? ' — ' + esc(v.note) : ''}</option>`)
      .join('');
    if (state.selectedVersionNo === null) {
      state.selectedVersionNo = state.versions[0].version_no;
      sel.value = String(state.selectedVersionNo);
    }
  }
  updatePlayButtons();
}

async function selectVersion(no) {
  if (state.session) {
    toast('本次排演已锁定版本，需先「结束排演」才能切换版本', 'error');
    return;
  }
  try {
    const snapshot = await api('GET', `/api/versions/${no}`);
    state.selectedVersionNo = no;
    state.snapshot = snapshot;
    state.time = 0;
    renderVersionSelect();
    renderReadonlyCues(snapshot);
    renderLevels();
    updateClock();
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#version-select').addEventListener('change', async (e) => {
  if (!e.target.value) return;
  await selectVersion(Number(e.target.value));
});

function renderReadonlyCues(snapshot) {
  const tbody = $('#cue-readonly tbody');
  const fname = Object.fromEntries(snapshot.fixtures.map((f) => [f.id, f.name]));
  if (!snapshot.cues.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">该版本没有 Cue。</td></tr>';
    return;
  }
  const sorted = [...snapshot.cues].sort((a, b) =>
    (a.trigger_time - b.trigger_time) || (a.cue_no - b.cue_no));
  tbody.innerHTML = sorted.map((c) => `
    <tr>
      <td class="num">${c.cue_no}</td>
      <td>${esc(fname[c.fixture_id] || `#${c.fixture_id}`)}</td>
      <td class="num">${fmt(c.trigger_time)}</td>
      <td class="num">${fmt(c.target_level)}</td>
      <td class="num">${fmt(c.duration)}${c.duration === 0 ? '（瞬变）' : ''}</td>
    </tr>`).join('');
}

function currentSnapshot() {
  return state.session ? state.session.snapshot : state.snapshot;
}
function currentDuration() {
  const s = currentSnapshot();
  return s ? LxEngine.durationOf(s) : 0;
}

function renderLevels() {
  const s = currentSnapshot();
  const wrap = $('#levels');
  if (!s || !s.fixtures.length) {
    wrap.innerHTML = '<p class="hint">该版本没有灯具。</p>';
    return;
  }
  const levels = LxEngine.levelsAt(s, state.time);
  wrap.innerHTML = s.fixtures.map((f) => {
    const v = levels[f.id];
    return `
      <div class="level-card">
        <div class="level-head">
          <span class="level-name">${f.id} · ${esc(f.name)}</span>
          <span class="level-value">${fmt(v)}</span>
        </div>
        <div class="level-track"><div class="level-fill" style="width:${v}%"></div></div>
        <div class="level-pct">${Math.round(v)}%</div>
      </div>`;
  }).join('');
}

function updateClock() {
  const d = currentDuration();
  $('#time-current').textContent = fmt(Math.min(state.time, d));
  $('#time-total').textContent = fmt(d);
  const slider = $('#seek');
  slider.max = String(Math.max(d, 1));
  slider.value = String(Math.min(state.time, Math.max(d, 1)));
}

function tickFrame(now) {
  if (!state.playing) return;
  const t = state.rafStartTime + (now - state.rafStartWall) / 1000;
  const d = currentDuration();
  state.time = t >= d ? d : t;
  renderLevels();
  updateClock();
  if (t >= d) {
    pause();
    return;
  }
  state.rafId = requestAnimationFrame(tickFrame);
}

function play() {
  const s = currentSnapshot();
  if (!s) { toast('请先发布并选择一个演出版本', 'error'); return; }
  // 关键：点「播放」的瞬间锁定版本快照；之后草稿/新版本都与本次播放无关
  if (!state.session) {
    state.session = {
      versionNo: state.selectedVersionNo,
      snapshot: s,
    };
  }
  const d = currentDuration();
  if (state.time >= d) state.time = 0; // 已到结尾再按播放 => 从头开始
  state.playing = true;
  state.rafStartWall = performance.now();
  state.rafStartTime = state.time;
  state.rafId = requestAnimationFrame(tickFrame);
  updatePlayButtons();
}

function pause() {
  state.playing = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  updatePlayButtons();
}

function stopSession() {
  pause();
  state.session = null; // 释放版本锁
  state.time = 0;
  const s = currentSnapshot();
  if (s) { renderLevels(); updateClock(); }
  updatePlayButtons();
  toast('排演已结束，可切换版本或继续编辑草稿', 'ok');
}

function seekTo(t) {
  const d = currentDuration();
  if (!Number.isFinite(t) || t < 0) { toast('跳转时刻必须是非负秒数', 'error'); return false; }
  if (t > d) t = d; // 允许跳到末尾
  state.time = t;
  if (state.playing) {
    state.rafStartWall = performance.now();
    state.rafStartTime = t;
  }
  renderLevels();
  updateClock();
  return true;
}

function updatePlayButtons() {
  const locked = !!state.session;
  $('#btn-play').disabled = state.playing || !currentSnapshot();
  $('#btn-pause').disabled = !state.playing;
  $('#btn-stop').disabled = !locked;
  $('#version-select').disabled = locked; // 会话期间锁定版本选择
  const badge = $('#playing-badge');
  badge.classList.toggle('hidden', !locked);
  if (locked) $('#playing-no').textContent = state.session.versionNo;
}

$('#btn-play').addEventListener('click', play);
$('#btn-pause').addEventListener('click', () => { pause(); toast('已暂停（仍使用锁定版本）'); });
$('#btn-stop').addEventListener('click', stopSession);

$('#seek').addEventListener('input', (e) => {
  if (!currentSnapshot()) return;
  seekTo(Number(e.target.value));
});

$('#btn-jump').addEventListener('click', () => {
  const input = $('#jump-time');
  if (input.value === '') return;
  seekTo(Number(input.value));
});
$('#jump-time').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#btn-jump').click();
});

// 空格键：播放/暂停
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') {
    e.preventDefault();
    state.playing ? pause() : play();
  }
});

// ---------- 启动 ----------
(async function init() {
  try {
    await loadDraft();
    await loadVersions();
    if (state.versions.length) {
      await selectVersion(state.versions[0].version_no); // 默认打开最新版本
    } else {
      renderLevels();
      updateClock();
      updatePlayButtons();
    }
  } catch (err) {
    toast(`初始化失败：${err.message}`, 'error');
  }
})();
