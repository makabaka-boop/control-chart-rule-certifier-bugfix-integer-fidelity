import { defineConfig, devices } from '@playwright/test'

/**
 * 浏览器只验证一次主流程：启动 web → 提交读数 →
 * 唯一违规判定、证据点在 SVG 与表格中一致呈现。
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
