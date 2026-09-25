import { test, expect } from '@playwright/test'

// 唯一的浏览器测试：完整主流程一次走通。
// target=0, sigma=10；末三点 [1,21,21] 中两点严格越 +2σ，
// 八点同侧也成立，但按规则顺序 end=7 取 R2。
test.describe('控制图核验台主流程', () => {
  test('提交读数后展示唯一可复核的失控证据（表格与 SVG 一致）', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: '控制图规则核验台' })).toBeVisible()
    await page.getByLabel(/target/).fill('0')
    await page.getByLabel(/sigma/).fill('10')
    await page.getByLabel(/readings/).fill('1 1 1 1 1 1 21 21')
    await page.getByRole('button', { name: '核验' }).click()

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
})
