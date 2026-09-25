/**
 * 控制图 SVG：读数折线/点、中心线与 σ 分区。
 * 数据全部来自 /api/evaluate 的响应，本组件不做任何规则判定。
 */
const WIDTH = 920
const PAD_L = 56
const PAD_R = 16
const PAD_T = 20
const PAD_B = 36
const PLOT_W = WIDTH - PAD_L - PAD_R
const PLOT_H = 360

const ZONE_COLOR = {
  beyond_plus: '#fde2e2',
  A_plus: '#fdf0d5',
  B_plus: '#e8f3e8',
  C_plus: '#f4f8f4',
  C_minus: '#f4f8f4',
  B_minus: '#e8f3e8',
  A_minus: '#fdf0d5',
  beyond_minus: '#fde2e2',
}

const POINT_COLOR = {
  beyond_plus: '#c0392b',
  A_plus: '#d68910',
  B_plus: '#7d9052',
  C_plus: '#7f8c8d',
  C_minus: '#7f8c8d',
  B_minus: '#7d9052',
  A_minus: '#d68910',
  beyond_minus: '#c0392b',
}

export default function ControlChart({ data }) {
  const { points, limits, target, sigma } = data
  const n = points.length
  const evidence = new Set(
    (data.violation?.evidence_indices || []),
  )

  const values = points.map((p) => p.value)
  const rawMin = Math.min(...values, limits.lcl_3s)
  const rawMax = Math.max(...values, limits.ucl_3s)
  // 留余量，保证越线点仍在可视区内
  const padY = Math.max(1, Math.ceil((rawMax - rawMin) * 0.08))
  const yMin = rawMin - padY
  const yMax = rawMax + padY

  const x = (i) => PAD_L + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W)
  const y = (v) => PAD_T + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H

  // 自上而下的水平分区（相邻两条参考线之间）
  const bands = [
    [yMax, limits.ucl_3s, '#f8d7d7'],
    [limits.ucl_3s, limits.upper_2s, ZONE_COLOR.A_plus],
    [limits.upper_2s, limits.upper_1s, ZONE_COLOR.B_plus],
    [limits.upper_1s, target, ZONE_COLOR.C_plus],
    [target, limits.lower_1s, ZONE_COLOR.C_minus],
    [limits.lower_1s, limits.lower_2s, ZONE_COLOR.B_minus],
    [limits.lower_2s, limits.lcl_3s, ZONE_COLOR.A_minus],
    [limits.lcl_3s, yMin, '#f8d7d7'],
  ].filter(([hi, lo]) => hi > lo)

  const lines = [
    [limits.ucl_3s, `+3σ = ${limits.ucl_3s}`, '#c0392b'],
    [limits.upper_2s, `+2σ = ${limits.upper_2s}`, '#d68910'],
    [limits.upper_1s, `+1σ = ${limits.upper_1s}`, '#7d9052'],
    [target, `中心线 = ${target}`, '#2c3e50'],
    [limits.lower_1s, `−1σ = ${limits.lower_1s}`, '#7d9052'],
    [limits.lower_2s, `−2σ = ${limits.lower_2s}`, '#d68910'],
    [limits.lcl_3s, `−3σ = ${limits.lcl_3s}`, '#c0392b'],
  ]

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ')

  return (
    <svg
      data-testid="control-chart"
      viewBox={`0 0 ${WIDTH} ${PAD_T + PLOT_H + PAD_B}`}
      className="chart"
      role="img"
      aria-label="控制图：读数、中心线与σ分区"
    >
      {bands.map(([hi, lo, fill], i) => (
        <rect
          key={i}
          x={PAD_L}
          y={y(Math.min(hi, yMax))}
          width={PLOT_W}
          height={Math.max(0, y(Math.max(lo, yMin)) - y(Math.min(hi, yMax)))}
          fill={fill}
        />
      ))}

      {lines.map(([v, label, color]) => (
        <g key={label}>
          <line
            x1={PAD_L}
            x2={PAD_L + PLOT_W}
            y1={y(v)}
            y2={y(v)}
            stroke={color}
            strokeWidth={v === target ? 2 : 1.2}
            strokeDasharray={v === target ? undefined : '6 4'}
          />
          <text x={PAD_L + 6} y={y(v) - 4} fontSize={11} fill={color}>
            {label}
          </text>
        </g>
      ))}

      <path d={linePath} fill="none" stroke="#2c3e50" strokeWidth={1.4} />

      {points.map((p) => (
        <circle
          key={p.index}
          cx={x(p.index)}
          cy={y(p.value)}
          r={evidence.has(p.index) ? 6.5 : 3.5}
          fill={POINT_COLOR[p.zone]}
          stroke={evidence.has(p.index) ? '#000' : '#fff'}
          strokeWidth={evidence.has(p.index) ? 2 : 1}
        >
          <title>{`#${p.index} 值=${p.value} 偏差=${p.deviation} 分区=${p.zone}`}</title>
        </circle>
      ))}

      {points.map((p) => (
        <text
          key={`t-${p.index}`}
          x={x(p.index)}
          y={PAD_T + PLOT_H + 20}
          fontSize={10}
          textAnchor="middle"
          fill="#555"
        >
          {p.index}
        </text>
      ))}
    </svg>
  )
}
