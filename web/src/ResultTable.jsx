/** 结果表格：与 SVG 共用同一份响应数据，证据行高亮。
 *  整数字段为 bigint，渲染处统一 toString，保证 2^53 以上逐位原样呈现。 */
const ZONE_LABEL = {
  beyond_plus: '>+3σ（越限）',
  A_plus: '+2σ ~ +3σ',
  B_plus: '+1σ ~ +2σ',
  C_plus: '中心线 ~ +1σ',
  center: '中心线',
  C_minus: '中心线 ~ −1σ',
  B_minus: '−1σ ~ −2σ',
  A_minus: '−2σ ~ −3σ',
  beyond_minus: '<−3σ（越限）',
}

const fmt = (v) => v.toString()
const fmtSigned = (d) => (d > 0n ? `+${fmt(d)}` : fmt(d))

export default function ResultTable({ data }) {
  const evidence = new Set(data.violation?.evidence_indices || [])
  return (
    <table className="result-table" data-testid="result-table">
      <thead>
        <tr>
          <th>下标</th>
          <th>读数</th>
          <th>偏差</th>
          <th>侧别</th>
          <th>分区</th>
          <th>证据</th>
        </tr>
      </thead>
      <tbody>
        {data.points.map((p) => (
          <tr
            key={fmt(p.index)}
            className={evidence.has(p.index) ? 'evidence-row' : undefined}
            data-index={fmt(p.index)}
          >
            <td>{fmt(p.index)}</td>
            <td>{fmt(p.value)}</td>
            <td>{fmtSigned(p.deviation)}</td>
            <td>{p.side === 'above' ? '上侧' : p.side === 'below' ? '下侧' : '中心'}</td>
            <td>{ZONE_LABEL[p.zone]}</td>
            <td>{evidence.has(p.index) ? '●' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
