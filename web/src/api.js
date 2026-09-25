import { parseLossless, parseIntegerToken, stringifyLossless } from './lossless-json.js'

/** 调用后端规则接口。
 *  请求体用无损序列化（bigint 原样写出），响应用无损解析（整数字面量 → bigint），
 *  保证 2^53 以上的整数在传输前后是同一个数，而不是被双精度舍入后的另一个数。
 *  422 时抛出带字段级详情的错误。
 */
export async function evaluateReadings({ target, sigma, readings }) {
  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringifyLossless({ target, sigma, readings }),
  })
  const body = parseLossless(await res.text())
  if (res.status === 422) {
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
  return body
}

/** 解析读数文本：逗号、空白、换行分隔，必须全部是整数；值以 bigint 保留。 */
export function parseReadings(text) {
  const tokens = text.split(/[\s,，;；]+/).filter(Boolean)
  const values = []
  for (const tok of tokens) {
    values.push(parseIntegerToken(tok, '整数'))
  }
  return values
}
