import { test, expect } from '@playwright/test'

// 2^53：JavaScript Number 在它以上无法区分相邻整数。
const P53 = '9007199254740992'
const P53_P1 = '9007199254740993'
const P53_M1 = '9007199254740991'
const NEG_P53_M1 = '-9007199254740993'

/**
 * 用最小正则从原始响应文本中提取整数字段（不经过 JSON.parse，
 * 避免 Number 舍入，逐位比对页面与接口的数值身份）。
 */
function numField(text, key) {
  const m = text.match(new RegExp(`"${key}":(-?\\d+)`))
  if (!m) throw new Error(`响应缺少字段 ${key}: ${text.slice(0, 200)}`)
  return m[1]
}

async function submit(page, target, sigma, readings) {
  await page.getByLabel(/target/).fill(target)
  await page.getByLabel(/sigma/).fill(sigma)
  await page.getByLabel(/readings/).fill(readings)
  await page.getByRole('button', { name: '核验' }).click()
}

test.describe('控制图核验台主流程', () => {
  test('提交读数后展示唯一可复核的失控证据（表格与 SVG 一致）', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '控制图规则核验台' })).toBeVisible()
    await submit(page, '0', '10', '1 1 1 1 1 1 21 21')

    // 唯一判定：R2，结束下标 7，证据下标 6,7
    const verdict = page.getByTestId('verdict')
    await expect(verdict).toContainText('失控：R2')
    await expect(verdict).toContainText('结束下标 7')
    await expect(verdict).toContainText('证据下标 6, 7')

    // SVG 已绘制：8 个读数圆点，其中 2 个证据大点
    const chart = page.getByTestId('control-chart')
    await expect(chart).toBeVisible()
    await expect(chart.locator('circle')).toHaveCount(8)
    await expect(chart.locator('circle[r="6.5"]')).toHaveCount(2)
    await expect(chart.locator('line')).toHaveCount(7) // 中心线 + 六条 σ 线

    // 表格只有两行证据高亮，且下标正是 6、7
    const evidenceRows = page.locator('.evidence-row')
    await expect(evidenceRows).toHaveCount(2)
    await expect(evidenceRows.nth(0)).toHaveAttribute('data-index', '6')
    await expect(evidenceRows.nth(1)).toHaveAttribute('data-index', '7')

    // 每点分区都在表格中呈现（边界 1 → C 区，21 → +2σ~+3σ 的 A 区）
    await expect(page.locator('.result-table tbody tr')).toHaveCount(8)
    await expect(page.locator('.result-table tbody tr').nth(0)).toContainText('中心线 ~ +1σ')
    await expect(page.locator('.result-table tbody tr').nth(7)).toContainText('+2σ ~ +3σ')
  })

  // 2^53 附近的临界样本：页面、原始接口、规则结论、图表标记四处一致。
  const criticalCases = [
    {
      name: '正目标 2^53+1：两点 d=-3 严格越 2σ → R2（舍入会误判稳定）',
      target: P53_P1,
      sigma: '1',
      readings: `${P53_M1 - 1} ${P53_M1 - 1} ${P53_P1}`,
      values: ['9007199254740990', '9007199254740990', P53_P1],
      rule: 'R2',
      side: '下侧',
      end: '2',
      evidence: ['0', '1'],
      centerLabel: `中心线 = ${P53_P1}`,
      lcl3Label: `−3σ = 9007199254740990`,
    },
    {
      name: '目标 2^53：读数恰在 -3σ 边界 → 稳定（舍入会误报 R1）',
      target: P53,
      sigma: '1',
      readings: `${P53} ${P53_M1 - 2}`,
      values: [P53, '9007199254740989'],
      rule: null,
      evidence: [],
      centerLabel: `中心线 = ${P53}`,
      lcl3Label: `−3σ = ${P53_M1 - 2}`,
    },
    {
      name: '负目标 -(2^53+1)：两点 d=+3 → R2（舍入会误判稳定）',
      target: NEG_P53_M1,
      sigma: '1',
      readings: `-9007199254740990 -9007199254740990 ${NEG_P53_M1}`,
      values: ['-9007199254740990', '-9007199254740990', NEG_P53_M1],
      rule: 'R2',
      side: '上侧',
      end: '2',
      evidence: ['0', '1'],
      centerLabel: `中心线 = ${NEG_P53_M1}`,
      lcl3Label: `−3σ = -9007199254740996`,
    },
    {
      name: 'sigma=2^53：读数超出 3σ 一个单位 → R1（控制线必须精确）',
      target: '0',
      sigma: P53,
      readings: `0 27021597764222977`,
      values: ['0', '27021597764222977'],
      rule: 'R1',
      side: '上侧',
      end: '1',
      evidence: ['1'],
      centerLabel: '中心线 = 0',
      lcl3Label: `−3σ = -27021597764222976`,
    },
  ]

  for (const c of criticalCases) {
    test(`临界样本：${c.name}`, async ({ page, baseURL }) => {
      await page.goto('/')
      await submit(page, c.target, c.sigma, c.readings)

      const verdict = page.getByTestId('verdict')
      await expect(verdict).toBeVisible()
      if (c.rule) {
        await expect(verdict).toContainText(`失控：${c.rule}`)
        if (c.side) await expect(verdict).toContainText(c.side)
        await expect(verdict).toContainText(`结束下标 ${c.end}`)
        await expect(verdict).toContainText(`证据下标 ${c.evidence.join(', ')}`)
      } else {
        await expect(verdict).toContainText('过程稳定')
      }

      // 表格：逐点读数为原文精确值，证据行与结论一致
      const rows = page.locator('.result-table tbody tr')
      await expect(rows).toHaveCount(c.values.length)
      for (let i = 0; i < c.values.length; i += 1) {
        await expect(rows.nth(i)).toHaveAttribute('data-value', c.values[i])
      }
      const evidenceRows = page.locator('.evidence-row')
      await expect(evidenceRows).toHaveCount(c.evidence.length)
      for (let i = 0; i < c.evidence.length; i += 1) {
        await expect(evidenceRows.nth(i)).toHaveAttribute('data-index', c.evidence[i])
      }

      // 图表：证据大点数量、中心线/控制线标签均为精确大整数
      const chart = page.getByTestId('control-chart')
      await expect(chart).toBeVisible()
      await expect(chart.locator('circle')).toHaveCount(c.values.length)
      await expect(chart.locator('circle[r="6.5"]')).toHaveCount(c.evidence.length)
      await expect(chart.locator('text', { hasText: c.centerLabel })).toBeVisible()
      await expect(chart.locator('text', { hasText: c.lcl3Label })).toBeVisible()

      // 原始接口：请求体逐位发出，响应文本逐位保留；与页面结论一致
      const requestBody = `{"target":${c.target},"sigma":${c.sigma},"readings":[${c.values.join(',')}]}`
      const raw = await page.evaluate(async ({ base, body }) => {
        const res = await fetch(`${base}/api/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
        if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
        return res.text()
      }, { base: baseURL, body: requestBody })
      expect(numField(raw, 'target')).toBe(c.target)
      expect(numField(raw, 'sigma')).toBe(c.sigma)
      // points 数组（顶层响应末尾）逐点读数；violation.evidence 会重复证据点，
      // 所以从 "points":[ ... ] 片段中提取。
      const pointsSeg = raw.slice(raw.lastIndexOf('"points"'))
      const evidenceValues = [...pointsSeg.matchAll(/"value":(-?\d+)/g)].map((m) => m[1])
      expect(evidenceValues).toEqual(c.values)
      if (c.rule) {
        expect(raw).toContain(`"rule_id":"${c.rule}"`)
        expect(raw).toContain(`"end_index":${c.end}`)
      } else {
        expect(raw).toContain('"violation":null')
      }
    })
  }

  test('普通边界样本不回退：恰在 +3σ 边界稳定，越过一个单位即 R1', async ({ page }) => {
    await page.goto('/')

    // target=10, sigma=2：16 正好 +3σ，不越过 → 稳定
    await submit(page, '10', '2', '10 16')
    await expect(page.getByTestId('verdict')).toContainText('过程稳定')
    const chart = page.getByTestId('control-chart')
    await expect(chart.locator('circle[r="6.5"]')).toHaveCount(0)
    await expect(chart.locator('text', { hasText: '+3σ = 16' })).toBeVisible()
    await expect(page.locator('.result-table tbody tr').nth(1)).toContainText('+2σ ~ +3σ')

    // 越过一个单位 → R1，证据下标 1
    await submit(page, '10', '2', '10 17')
    const verdict = page.getByTestId('verdict')
    await expect(verdict).toContainText('失控：R1')
    await expect(verdict).toContainText('结束下标 1')
    await expect(page.locator('.evidence-row')).toHaveCount(1)
    await expect(page.locator('.evidence-row').first()).toHaveAttribute('data-index', '1')
    await expect(page.locator('.evidence-row').first()).toHaveAttribute('data-value', '17')
  })

  test('非整数与非正 sigma 仍被页面拒绝（不发请求）', async ({ page }) => {
    await page.goto('/')
    await submit(page, '1.5', '2', '10 11')
    await expect(page.getByTestId('error-banner')).toContainText('target 必须是整数')

    await submit(page, '10', '0', '10 11')
    await expect(page.getByTestId('error-banner')).toContainText('sigma 必须是正整数')

    await submit(page, '10', '2', '10 11.5')
    await expect(page.getByTestId('error-banner')).toContainText('不是整数')
  })
})
