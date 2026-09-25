import { test, expect, request as pwRequest } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 直接复用前端无损解析器（ESM），E2E 侧逐位核对 wire 文本
const here = dirname(fileURLToPath(import.meta.url))
let parseLossless

test.beforeAll(async () => {
  ;({ parseLossless } = await import(
    resolve(here, '../../web/src/lossless-json.js')
  ))
})

const P53 = '9007199254740992' // 2^53
const P53_P1 = '9007199254740993' // 2^53+1：双精度下会被舍入成 2^53
const N53_M1 = '-9007199254740993' // -(2^53+1)

// 提交并同时抓包：返回页面展示数据与原始请求/响应（均为未解析文本）
async function submitAndCapture(page, { target, sigma, readings }) {
  const captured = { requestBody: null, responseBody: null, status: null }
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/evaluate')) {
      captured.requestBody = req.postData()
    }
  })
  page.on('response', async (res) => {
    if (res.url().includes('/api/evaluate')) {
      captured.status = res.status()
      captured.responseBody = await res.text()
    }
  })

  await page.getByLabel(/target/).fill(target)
  await page.getByLabel(/sigma/).fill(sigma)
  await page.getByLabel(/readings/).fill(readings)
  await page.getByRole('button', { name: '核验' }).click()
  await expect(page.getByTestId('result-table')).toBeVisible()
  return captured
}

test.describe('2^53 临界整数：输入/请求/判定/响应/图表同一数值身份', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('正目标 2^53+1：+3σ 边界稳定，+3σ+1 判 R1，页面/原始接口/图表逐位一致', async ({ page }) => {
    // 同一表单先验证严格边界（=target+3σ 不算越过），再验证 +1 越线
    let cap = await submitAndCapture(page, {
      target: P53_P1,
      sigma: '1',
      readings: `${P53_P1} ${BigInt(P53_P1) + 3n}`,
    })
    await expect(page.getByTestId('verdict')).toContainText('过程稳定')

    // 原始请求体逐位保留，未被双精度改写
    expect(cap.status).toBe(200)
    expect(cap.requestBody).toContain(`"target":${P53_P1}`)
    const reqParsed = parseLossless(cap.requestBody)
    expect(reqParsed.target).toBe(BigInt(P53_P1))
    expect(reqParsed.readings[1]).toBe(BigInt(P53_P1) + 3n)
    let resp = parseLossless(cap.responseBody)
    expect(resp.stable).toBe(true)
    expect(resp.limits.ucl_3s).toBe(BigInt(P53_P1) + 3n)

    // 越线样本：target+3σ+1 → R1，结束下标 1
    cap = await submitAndCapture(page, {
      target: P53_P1,
      sigma: '1',
      readings: `${P53_P1} ${BigInt(P53_P1) + 4n}`,
    })
    const verdict = page.getByTestId('verdict')
    await expect(verdict).toContainText('失控：R1')
    await expect(verdict).toContainText('结束下标 1')

    resp = parseLossless(cap.responseBody)
    // 页面、原始接口、规则结论一致
    expect(resp.stable).toBe(false)
    expect(resp.violation.rule_id).toBe('R1')
    expect(resp.violation.end_index).toBe(1n)
    const evidenceValue = resp.violation.evidence[0].value
    expect(evidenceValue).toBe(BigInt(P53_P1) + 4n)

    // 表格读数单元格逐位等于接口原始值（不是 9007199254740992 之类舍入值）
    const row1 = page.locator('.result-table tbody tr').nth(1)
    await expect(row1.locator('td').nth(1)).toHaveText((BigInt(P53_P1) + 4n).toString())
    await expect(row1).toContainText('>+3σ')

    // SVG 控制线标签与证据点 tooltip 逐位精确
    const chart = page.getByTestId('control-chart')
    await expect(chart).toBeVisible()
    await expect(chart.getByText(`中心线 = ${P53_P1}`)).toBeVisible()
    await expect(chart.getByText(`+3σ = ${(BigInt(P53_P1) + 3n).toString()}`)).toBeVisible()
    const evidenceCircle = chart.locator('circle[r="6.5"]')
    await expect(evidenceCircle).toHaveCount(1)
    // 证据点在 +3σ 上方，像素应严格高于 +3σ 控制线（y 向下为正）
    const cy = Number(await evidenceCircle.getAttribute('cy'))
    const lineY = Number(
      await chart.locator('line[stroke="#c0392b"]').first().getAttribute('y1'),
    )
    expect(cy).toBeLessThan(lineY)
    // tooltip 文本（title 元素）包含逐位读数
    const titleText = await evidenceCircle.locator('title').textContent()
    expect(titleText).toContain(`值=${(BigInt(P53_P1) + 4n).toString()}`)
  })

  test('负目标 -(2^53+1)：下侧严格边界与 R1 逐位一致', async ({ page }) => {
    // 正好 -3σ：稳定
    let cap = await submitAndCapture(page, {
      target: N53_M1,
      sigma: '1',
      readings: `${N53_M1} ${BigInt(N53_M1) - 3n}`,
    })
    await expect(page.getByTestId('verdict')).toContainText('过程稳定')
    let resp = parseLossless(cap.responseBody)
    expect(resp.stable).toBe(true)
    expect(resp.limits.lcl_3s).toBe(BigInt(N53_M1) - 3n)
    expect(cap.requestBody).toContain(`"target":${N53_M1}`)

    // -3σ-1：R1 下侧
    cap = await submitAndCapture(page, {
      target: N53_M1,
      sigma: '1',
      readings: `${N53_M1} ${BigInt(N53_M1) - 4n}`,
    })
    await expect(page.getByTestId('verdict')).toContainText('失控：R1')
    resp = parseLossless(cap.responseBody)
    expect(resp.violation.side).toBe('below')
    expect(resp.violation.evidence[0].value).toBe(BigInt(N53_M1) - 4n)

    const row1 = page.locator('.result-table tbody tr').nth(1)
    await expect(row1.locator('td').nth(1)).toHaveText(
      (BigInt(N53_M1) - 4n).toString(),
    )
    await expect(
      page.getByTestId('control-chart').getByText(`−3σ = ${(BigInt(N53_M1) - 3n).toString()}`),
    ).toBeVisible()
  })

  test('sigma 取 2^53：严格倍数边界不漂移', async ({ page }) => {
    const sigma = BigInt(P53)
    // target=0，读数正好 -3σ：稳定；响应控制线逐位精确
    const cap = await submitAndCapture(page, {
      target: '0',
      sigma: P53,
      readings: `0 -${sigma * 3n}`,
    })
    await expect(page.getByTestId('verdict')).toContainText('过程稳定')
    const resp = parseLossless(cap.responseBody)
    expect(resp.stable).toBe(true)
    expect(resp.limits.ucl_3s).toBe(sigma * 3n)
    expect(resp.limits.lcl_3s).toBe(-sigma * 3n)
    expect(resp.limits.upper_2s).toBe(sigma * 2n)
    expect(resp.points[1].zone).toBe('A_minus')

    // 请求体中的 sigma 逐位
    expect(cap.requestBody).toContain(`"sigma":${P53}`)
    await expect(
      page.getByTestId('control-chart').getByText(`−3σ = ${(-sigma * 3n).toString()}`),
    ).toBeVisible()
  })

  test('复合规则 R2 在大目标上仍判定正确，证据下标与标记一致', async ({ page }) => {
    const t = BigInt(P53_P1)
    // 三点窗口中两点严格越过 +2σ（值 = target+2σ+1）→ R2，end=2
    const readings = `${t + 3n} ${t + 3n} ${t}`
    const cap = await submitAndCapture(page, { target: P53_P1, sigma: '1', readings })
    const verdict = page.getByTestId('verdict')
    await expect(verdict).toContainText('失控：R2')
    await expect(verdict).toContainText('证据下标 0, 1')

    const resp = parseLossless(cap.responseBody)
    expect(resp.violation.rule_id).toBe('R2')
    expect(resp.violation.evidence_indices).toEqual([0n, 1n])
    await expect(page.locator('.evidence-row')).toHaveCount(2)
    await expect(
      page.getByTestId('control-chart').locator('circle[r="6.5"]'),
    ).toHaveCount(2)
    // 表格行值与原始接口逐位一致
    const rows = page.locator('.result-table tbody tr')
    await expect(rows.nth(0).locator('td').nth(1)).toHaveText((t + 3n).toString())
    await expect(rows.nth(2).locator('td').nth(1)).toHaveText(t.toString())
  })

  test('直接打原始接口：精确大整数证据点不被舍入，与页面同一份数据', async ({ page, baseURL }) => {
    const ctx = await pwRequest.newContext({ baseURL })
    const payload = `{"target":${P53_P1},"sigma":1,"readings":[${P53_P1},${BigInt(P53_P1) + 4n}]}`
    const apiRes = await ctx.post('/api/evaluate', {
      data: payload,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(apiRes.ok()).toBeTruthy()
    const raw = await apiRes.text()
    // 原始 wire 文本逐位包含精确大整数（target 与证据值）
    expect(raw).toContain(`"target":${P53_P1}`)
    expect(raw).toContain((BigInt(P53_P1) + 4n).toString())
    const wireParsed = parseLossless(raw)
    // 解析回来的 target 绝不是双精度舍入后的值 2^53
    expect(wireParsed.target).toBe(BigInt(P53_P1))
    expect(wireParsed.target).not.toBe(BigInt(P53))

    // 页面提交同样输入，表格/结论与原始接口一致
    await submitAndCapture(page, {
      target: P53_P1,
      sigma: '1',
      readings: `${P53_P1} ${BigInt(P53_P1) + 4n}`,
    })
    await expect(page.getByTestId('verdict')).toContainText('失控：R1')
    const api = parseLossless(raw)
    const rowValue = await page
      .locator('.result-table tbody tr')
      .nth(1)
      .locator('td')
      .nth(1)
      .textContent()
    expect(BigInt(rowValue)).toBe(api.violation.evidence[0].value)
    await ctx.dispose()
  })

  test('无法忠实解析的输入被明确拒绝，不发请求、不放行', async ({ page }) => {
    let requestSent = false
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/evaluate')) requestSent = true
    })
    // target 为浮点样式：明确拒绝，不会先 Number() 改写成 1 再传输
    await page.getByLabel(/target/).fill('1.0')
    await page.getByLabel(/sigma/).fill('10')
    await page.getByLabel(/readings/).fill('1 2')
    await page.getByRole('button', { name: '核验' }).click()
    await expect(page.getByTestId('error-banner')).toHaveText('target 必须是整数')
    expect(requestSent).toBe(false)

    // sigma 非正：拒绝
    await page.getByLabel(/target/).fill('0')
    await page.getByLabel(/sigma/).fill('0')
    await page.getByRole('button', { name: '核验' }).click()
    await expect(page.getByTestId('error-banner')).toHaveText('sigma 必须是正整数')

    // 读数含指数样式：拒绝，不会被改写成 1000
    await page.getByLabel(/sigma/).fill('10')
    await page.getByLabel(/readings/).fill('1 1e3')
    await page.getByRole('button', { name: '核验' }).click()
    await expect(page.getByTestId('error-banner')).toContainText('不是整数')
  })

  test('普通边界样本不回退：target=10 sigma=2，读数 16/4 全部稳定', async ({ page }) => {
    await submitAndCapture(page, { target: '10', sigma: '2', readings: '16 4 10' })
    await expect(page.getByTestId('verdict')).toContainText('过程稳定')
    const rows = page.locator('.result-table tbody tr')
    await expect(rows).toHaveCount(3)
    // 16 正好 +3σ → A 区内侧，4 正好 -3σ
    await expect(rows.nth(0)).toContainText('+2σ ~ +3σ')
    await expect(rows.nth(1)).toContainText('−2σ ~ −3σ')
    await expect(rows.nth(2)).toContainText('中心线')
    await expect(
      page.getByTestId('control-chart').getByText('中心线 = 10'),
    ).toBeVisible()
  })
})
