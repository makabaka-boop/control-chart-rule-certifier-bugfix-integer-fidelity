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

### 整数数值身份（超出 2^53 的大整数）

JavaScript `Number` 只能安全表示到 `2^53−1`，超过后相邻整数会被舍入成同一个
值，直接改变严格倍数边界的判定。为保证被声明接受的整数在
**输入 → 请求 → 规则判定 → 响应 → 图表** 中保持同一数值身份：

- 页面不经过 `Number()` / `JSON.stringify` 转换，直接把规范化十进制整数字面量
  拼进请求体；
- 响应由前端自带的无损 JSON 解析器读取：安全范围内仍是 `number`，超出
  `±(2^53−1)` 的整数解析为 `BigInt`；
- 图表值轴的比较、极差与取整全部走 `BigInt`，仅在映射像素坐标时转为
  `number`；控制线标签、证据点标题与表格读数始终显示精确十进制文本；
- 后端 Python/Pydantic 本就按任意精度整数比较，大整数不设上下限；
- 非整数（浮点、布尔、含小数点的读数）与非正 `sigma` 仍在输入与接口两处拒绝，
  不存在静默改写后放行的路径。

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

`backend/tests/oracle.py` 是独立书写的直白逐窗口扫描 oracle，与被测引擎不共享抽象；300 组随机数据逐点对拍规则、结束下标、侧别、证据序列与分区，另含手工边界用例与 422 校验。

```bash
cd backend
pip install -r requirements-dev.txt
pytest                      # 351 passed（含 10 个 2^53 附近大整数临界用例）
```

### 前端：无损解析单元测试

`web/src/api.test.js` 用 Node 内置测试运行器验证无损 JSON 解析（安全整数保持
`number`、超出范围为 `BigInt`、相邻大整数可区分）、整数规范化与读数解析：

```bash
cd web
npm install
npm run test:unit
```

### 浏览器：主流程 + 2^53 临界样本

E2E 覆盖：原主流程（R2 + 证据点一致）、`±2^53` 附近的正/负目标、读数、
`sigma=2^53` 临界样本（页面、原始接口文本、规则结论、SVG 证据标记四方对拍），
以及普通 +3σ 边界不回退：

```bash
docker compose up --build -d
cd e2e
npm install
npx playwright install --with-deps chromium
npm run test:e2e            # 默认访问 http://localhost:8080
# E2E_BASE_URL=http://localhost:5173 npm run test:e2e   # 指向 vite dev/preview
```

工程师最终在页面上看到的是唯一的、可逐点复核的失控证据：违规规则、结束下标、证据下标以及每个读数所在分区。
