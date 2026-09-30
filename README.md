# 🎭 小剧场灯光 Cue 排演（lx-cue）

一款用于小剧场灯光排演的 Web 应用：录入灯具与灯光 **Cue**，在浏览器里按时间线
**播放 / 暂停 / 跳转**，实时查看任意时刻每台灯的亮度。**纯软件模拟，不连接任何真实灯具。**

- 后端：Node.js + Express + SQLite（[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)）
- 前端：原生 HTML/CSS/JS，无构建步骤
- 渐变：线性插值，新 Cue 到达时从该时刻**实际亮度**折向新目标
- 版本：发布即生成**不可变快照**，播放器始终使用开始排演时锁定的版本

## 一键启动（Docker Compose，推荐）

前置：已安装 Docker 与 Docker Compose v2。

```bash
docker compose up --build -d
```

启动完成后访问：

> **http://localhost:3000**

停止 / 查看日志：

```bash
docker compose down          # 停止（数据保留在命名卷中）
docker compose logs -f       # 跟踪日志
```

数据保存在 Docker 命名卷 `lx-cue-data` 内（容器路径 `/app/data/lx-cue.db`），
重新构建镜像不会丢失灯具、Cue 与已发布版本。

修改宿主机端口（例如改为 8080）：

```bash
HOST_PORT=8080 docker compose up --build -d   # 然后访问 http://localhost:8080
```

## 本地直接运行（Node 20+）

```bash
npm install
npm start
```

运行单元测试：

```bash
npm test
```

## 配置

通过环境变量配置（均有默认值，可全部省略）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址（容器内保持 `0.0.0.0`） |
| `DB_PATH` | `./data/lx-cue.db`（本地）/ `/app/data/lx-cue.db`（容器） | SQLite 数据库文件路径；首次启动自动建表初始化，无需手工迁移 |

Docker Compose 另支持：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST_PORT` | `3000` | 映射到宿主机的端口 |

## 使用流程

1. **灯具页**：录入灯具（编号由系统分配，名称唯一）。被 Cue 引用的灯具不能删除。
2. **草稿 Cue 页**：以表格整批编辑 Cue，点「保存草稿 Cue」整批提交：
   - `Cue #`：正整数、草稿内唯一；决定**同秒触发的生效顺序**（小编号先生效）。
   - `灯具`：必须是已存在的灯具编号。
   - `触发时刻 s`：**非负演出秒数**（支持小数）。
   - `目标亮度`：`0～100`（支持小数）。
   - `渐变时长 s`：**非负秒数**；`0` 表示瞬变。
   - 任一行出现非法时码、未知灯具或越界亮度，**整次提交都会被拒绝**（数据库事务回滚，不会保存任何一行），并在界面上指出原因。
3. **演出版本页**：点「发布当前草稿为新版本」生成不可变快照。版本只追加、永不修改。
4. **排演播放页**：选择版本 → 播放 / 暂停 / 结束排演；可用滑条或输入秒数跳转，
   随时查看每台灯在当前时刻的实际亮度。空格键 = 播放/暂停。

### 关键排演规则

- 所有灯具初始亮度为 `0`。
- 亮度在渐变区间内按**线性**变化，结束后保持目标值。
- 同一灯在渐变途中收到新 Cue 时，以**新 Cue 触发瞬间的实际亮度**为起点折向新目标
  （旧渐变立即作废）。
- 同一时刻触发的多条 Cue 按 **Cue 编号升序**依次生效。
- 播放使用**点击播放那一刻锁定的版本快照**：排演进行中编辑草稿、再次发布，
  都不会改变在播结果；需点「结束排演」后才会切换版本。

## 目录结构

```
.
├── Dockerfile              # 多阶段构建（依赖安装 + 启动）
├── docker-compose.yml      # 一键构建、初始化数据卷并启动
├── package.json
├── server/
│   ├── server.js           # Express HTTP API + 静态资源
│   ├── db.js               # SQLite 连接与建表（草稿表 + 不可变版本快照表）
│   ├── store.js            # 事务化业务逻辑（整批校验/发布快照）
│   └── validate.js         # 时码、灯具、亮度校验
├── shared/
│   └── engine.js           # 线性渐变模拟引擎（浏览器与 Node 共用）
├── public/                 # 前端（index.html / styles.css / app.js）
└── test/
    └── engine.test.js      # 模拟引擎单元测试（npm test）
```

## HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/draft` | 当前草稿（灯具 + Cue） |
| `POST` | `/api/draft/fixtures` | 新增灯具 `{name}` |
| `DELETE` | `/api/draft/fixtures/:id` | 删除灯具（被引用则 409） |
| `PUT` | `/api/draft/cues` | **整批替换**草稿 Cue `{cues:[...]}`，任一非法整体回滚 |
| `POST` | `/api/versions` | 发布不可变版本 `{note?}` |
| `GET` | `/api/versions` | 版本列表 |
| `GET` | `/api/versions/:n` | 第 n 版完整快照（播放器只读它） |
| `GET` | `/api/health` | 健康检查 |
