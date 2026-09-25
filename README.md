# 控制图规则核验台

过程工程师复核控制图时，单点没有越过三倍标准差并不代表过程稳定——连续同侧与窗口内多点偏移同样构成失控证据。本项目提供一个轻量全栈核验台：

- **React + SVG** 绘制读数折线、中心线与 ±1σ/±2σ/±3σ 分区；
- **FastAPI** 使用精确整数比较判定四条规则，返回首个违规、证据点与每点分区；
- 表格与 SVG 共用同一份 `/api/evaluate` 响应；
- **Docker Compose** 一键运行 `web`（nginx 静态站 + 反向代理）与 `api`。

## 规则定义

全部比较均为严格比较，**等于边界不算越过**：

| 规则 | 判定 |
|----|----|
| R1 | 一点严格越过 3σ（`|x−target| > 3·sigma`） |
| R2 | 连续三点中至少两点严格越过**同侧** 2σ |
| R3 | 连续五点中至少四点严格越过**同侧** 1σ |
| R4 | 连续八点严格位于中心线**同侧**（中心线点不属于任一侧） |

命中多个规则时，首个违规按以下优先级唯一确定：

1. 结束下标最小（窗口规则的结束下标为滑动窗口最后一点的下标）；
2. 结束下标相同按规则顺序 R1 → R2 → R3 → R4；
3. 再相同取证据下标序列字典序最小。

分区代码：`beyond_plus/beyond_minus`（严格越 3σ）、`A_*`（2σ–3σ）、`B_*`（1σ–2σ）、`C_*`（中心线–1σ）、`center`。

## API

`POST /api/evaluate`

```json
{ "target": 0, "sigma": 10, "readings": [1, 1, 1, 1, 1, 1, 21, 21] }
```

- `target`：整数；`sigma`：正整数；`readings`：2–200 个整数（读数本身无数值上下限）。
- 字段缺失、未知字段、类型不符（浮点/布尔/字符串）、`sigma ≤ 0`、读数数量越界均返回 **422**。
- 响应包含 `stable`、`violation`（`rule_id`/`side`/`end_index`/`evidence_indices`/`evidence`）、`limits` 与每点 `points`（含 `deviation`、`side`、`beyond_*`、`zone`）。

## 大整数：同一数值身份

`target` / `sigma` / `readings` 没有数值上限，2^53 以上的整数也必须被忠实处理，不允许静默舍入改变放行结论：

- **后端**：Python 任意精度整数，严格整数比较，响应 wire 文本逐位输出大整数（不用指数/小数）。
- **前端**：表单输入按十进制原文解析为 `BigInt`；请求体由 `web/src/lossless-json.js` 的无损序列化器逐位写出（不经 `JSON.stringify`/`Number`）；响应由无损解析器把所有整数字面量解析为 `BigInt`（不经 `JSON.parse`）。
- **图表**：值域、控制线与比例映射全部以 `BigInt` 精确计算，仅在最终像素坐标处转 `Number`；控制线标签、证据点 tooltip、表格读数/偏差均逐位显示。
- 无法解析为整数的输入（`1.0`、`1e3`、`0x1`、空白夹杂等）在表单处明确拒绝，不会被改写后放行。

## 运行（Docker Compose）

```bash
docker compose up --build
# web:  http://localhost:8080
# api:  http://localhost:8000 （健康检查 GET /health）
```

## 本地开发

```bash
# API（:8000）
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Web（:5173，/api 代理到 :8000）
cd web
npm install
npm run dev
```

## 测试

### 后端：朴素窗口扫描对拍

`backend/tests/oracle.py` 是独立书写的直白逐窗口扫描 oracle，与被测引擎不共享抽象；300 组随机数据逐点对拍规则、结束下标、侧别、证据序列与分区，另含手工边界用例、422 校验与 2^53 附近大整数端到端精度用例。

```bash
cd backend
pip install -r requirements-dev.txt
pytest                      # 347 passed
```

### 前端：无损 JSON 单元测试

```bash
cd web
npm test                    # node --test，覆盖 2^53 临界整数的解析/序列化往返与严格语法
```

### 浏览器：主流程 + 2^53 临界样本

E2E 共 7 条：原有主流程 1 条（提交 → R2 判定 → 证据点在 SVG 与表格中一致），另 6 条以 2^53 附近的正/负 target、sigma、读数构造临界样本，逐位比对页面、抓包的原始请求/响应、规则结论与图表标记，并核对普通边界样本不回退：

```bash
docker compose up --build -d
cd e2e
npm install
npx playwright install --with-deps chromium
npm run test:e2e            # 默认访问 http://localhost:8080
# E2E_BASE_URL=http://localhost:5173 npm run test:e2e   # 指向 vite dev
```

工程师最终在页面上看到的是唯一的、可逐点复核的失控证据：违规规则、结束下标、证据下标以及每个读数所在分区。
