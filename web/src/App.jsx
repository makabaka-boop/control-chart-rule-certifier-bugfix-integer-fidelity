import { useState } from 'react'
import { evaluateReadings, parseReadings } from './api.js'
import ControlChart from './ControlChart.jsx'
import ResultTable from './ResultTable.jsx'

const SIDE_LABEL = { above: '上侧', below: '下侧' }

export default function App() {
  const [target, setTarget] = useState('0')
  const [sigma, setSigma] = useState('10')
  const [readingsText, setReadingsText] = useState(
    '1 1 1 1 1 1 21 21',
  )
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setData(null)
    try {
      if (!/^[+-]?\d+$/.test(target.trim())) throw new Error('target 必须是整数')
      if (!/^[+-]?\d+$/.test(sigma.trim()) || BigInt(sigma.trim()) <= 0n) {
        throw new Error('sigma 必须是正整数')
      }
      const readings = parseReadings(readingsText)
      if (readings.length < 2 || readings.length > 200) {
        throw new Error(`readings 需要 2 至 200 个整数（当前 ${readings.length} 个）`)
      }
      // 以规范化十进制整数字符串发出，大整数不经 Number 舍入
      setData(
        await evaluateReadings({
          target: target.trim(),
          sigma: sigma.trim(),
          readings,
        }),
      )
    } catch (e) {
      setError(e.message)
    }
  }

  const v = data?.violation

  return (
    <main className="container">
      <h1>控制图规则核验台</h1>
      <p className="subtitle">
        精确整数判定：R1 一点越 3σ · R2 三点中两点越同侧 2σ · R3 五点中四点越同侧 1σ · R4 八点同侧
        （等于边界不算越过）
      </p>

      <form className="form" onSubmit={handleSubmit}>
        <label className="field">
          <span>target（整数）</span>
          <input
            name="target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="field">
          <span>sigma（正整数）</span>
          <input
            name="sigma"
            value={sigma}
            onChange={(e) => setSigma(e.target.value)}
            inputMode="numeric"
          />
        </label>
        <label className="field field-grow">
          <span>readings（2–200 个整数，空格或逗号分隔）</span>
          <input
            name="readings"
            value={readingsText}
            onChange={(e) => setReadingsText(e.target.value)}
          />
        </label>
        <button type="submit">核验</button>
      </form>

      {error && (
        <div className="banner banner-error" role="alert" data-testid="error-banner">
          {error}
        </div>
      )}

      {data && (
        <section className="result">
          {data.stable ? (
            <div className="banner banner-stable" data-testid="verdict">
              过程稳定：四条规则均未命中（单点未越 3σ，无连续同侧/窗口偏移证据）。
            </div>
          ) : (
            <div className="banner banner-violation" data-testid="verdict">
              <strong>失控：{v.rule_id}</strong> — {v.rule_name}（{SIDE_LABEL[v.side]}，首个违规结束下标{' '}
              {v.end_index}，证据下标 {v.evidence_indices.join(', ')}）
            </div>
          )}

          <ControlChart data={data} />
          <ResultTable data={data} />
        </section>
      )}
    </main>
  )
}
