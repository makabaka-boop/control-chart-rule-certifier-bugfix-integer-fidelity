/** 调用后端规则接口。422 时抛出带字段级详情的错误。 */
export async function evaluateReadings({ target, sigma, readings }) {
  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, sigma, readings }),
  })
  if (res.status === 422) {
    const body = await res.json()
    const messages = (body.detail || []).map((d) => {
      const loc = Array.isArray(d.loc) ? d.loc.slice(1).join('.') : ''
      return loc ? `${loc}: ${d.msg}` : d.msg
    })
    const err = new Error(messages.join('；') || '输入校验失败')
    err.kind = 'validation'
    throw err
  }
  if (!res.ok) {
    throw new Error(`服务异常（HTTP ${res.status}）`)
  }
  return res.json()
}

/** 解析读数文本：逗号、空白、换行分隔，必须全部是整数。 */
export function parseReadings(text) {
  const tokens = text.split(/[\s,，;；]+/).filter(Boolean)
  const values = []
  for (const tok of tokens) {
    if (!/^[+-]?\d+$/.test(tok)) {
      throw new Error(`读数「${tok}」不是整数`)
    }
    values.push(Number(tok))
  }
  return values
}
