/**
 * 调用后端规则接口。
 *
 * 控制图接受任意整数（读数本身无数值上下限），其中可能包含超出
 * Number.MAX_SAFE_INTEGER（2^53−1）的大整数。为了让被声明接受的整数
 * 在「输入 → 请求 → 响应 → 规则结论 → 图表」中保持同一数值身份：
 *
 *  - 请求体不经过 JSON.stringify 对 Number 的舍入，直接把规范化后的
 *    十进制整数字面量嵌入 JSON 文本；
 *  - 响应使用下方的无损 JSON 解析，超出安全整数范围的整数解析为
 *    BigInt（安全范围内仍为 number），证据点、控制线、读数不会被
 *    浏览器静默舍入。
 */

/** 把一个由整数 token 规范化而来的值安全嵌入 JSON：大整数用 BigInt 转字符串。 */
function integerLiteral(value) {
  if (typeof value === 'bigint') return value.toString()
  // 安全整数的 number 直接写成数字字面量；其它一律按十进制字符串处理
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  return String(value)
}

/** 规范化单个整数 token（去掉前导符号与前导零），返回十进制整数字符串。 */
export function canonicalInteger(token) {
  let t = token.trim()
  let neg = false
  if (t[0] === '+' || t[0] === '-') {
    neg = t[0] === '-'
    t = t.slice(1)
  }
  const digits = t.replace(/^0+(?=\d)/, '')
  return neg && digits !== '0' ? `-${digits}` : digits
}

export async function evaluateReadings({ target, sigma, readings }) {
  const targetLit = integerLiteral(target)
  const sigmaLit = integerLiteral(sigma)
  const readingLits = readings.map(integerLiteral)
  const body =
    `{"target":${targetLit},"sigma":${sigmaLit},` +
    `"readings":[${readingLits.join(',')}]}`

  const res = await fetch('/api/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  if (res.status === 422) {
    const body = parseLosslessJson(await res.text())
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
  return parseLosslessJson(await res.text())
}

/** 解析读数文本：逗号、空白、换行分隔，必须全部是整数，保留十进制原文身份。 */
export function parseReadings(text) {
  const tokens = text.split(/[\s,，;；]+/).filter(Boolean)
  const values = []
  for (const tok of tokens) {
    if (!/^[+-]?\d+$/.test(tok)) {
      throw new Error(`读数「${tok}」不是整数`)
    }
    values.push(canonicalInteger(tok))
  }
  return values
}

/* ------------------------------------------------------------------ */
/* 无损 JSON 解析：超出安全整数范围的整数解析为 BigInt。               */
/* ------------------------------------------------------------------ */

const SAFE_MAX = 9007199254740991n // 2^53 − 1
const SAFE_MIN = -9007199254740991n // −(2^53 − 1)

function parseIntegerLiteral(raw, neg) {
  const bi = BigInt(raw)
  const v = neg ? -bi : bi
  if (v <= SAFE_MAX && v >= SAFE_MIN) return Number(v)
  return v
}

/**
 * 与 JSON.parse 行为一致，但整数 token 超出 ±(2^53−1) 时返回 BigInt，
 * 浮点/指数形式仍按 number 解析（本接口的字段均为精确整数，理论上不会出现）。
 */
export function parseLosslessJson(text) {
  let i = 0
  const n = text.length

  function skipWs() {
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1
      else break
    }
  }

  function parseString() {
    // text[i] === '"'
    i += 1
    let out = ''
    while (i < n) {
      const ch = text[i]
      if (ch === '"') {
        i += 1
        return out
      }
      if (ch === '\\') {
        const e = text[i + 1]
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new SyntaxError(`JSON 中的 \\u 转义非法（位置 ${i}）`)
          }
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else {
          const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
          if (!(e in simple)) throw new SyntaxError(`JSON 中的非法转义 \\${e}（位置 ${i}）`)
          out += simple[e]
          i += 2
        }
      } else {
        out += ch
        i += 1
      }
    }
    throw new SyntaxError('JSON 字符串未闭合')
  }

  function parseNumber() {
    const start = i
    if (text[i] === '-') i += 1
    while (i < n && text[i] >= '0' && text[i] <= '9') i += 1
    let isFloat = false
    if (text[i] === '.') {
      isFloat = true
      i += 1
      while (i < n && text[i] >= '0' && text[i] <= '9') i += 1
    }
    if (text[i] === 'e' || text[i] === 'E') {
      isFloat = true
      i += 1
      if (text[i] === '+' || text[i] === '-') i += 1
      while (i < n && text[i] >= '0' && text[i] <= '9') i += 1
    }
    const raw = text.slice(start, i)
    if (isFloat) return Number(raw)
    const neg = raw[0] === '-'
    const digits = neg ? raw.slice(1) : raw
    if (digits.length > 1 && digits[0] === '0') {
      throw new SyntaxError(`JSON 数字不允许前导零：${raw}`)
    }
    return parseIntegerLiteral(digits, neg)
  }

  function parseLiteral() {
    if (text.startsWith('true', i)) {
      i += 4
      return true
    }
    if (text.startsWith('false', i)) {
      i += 5
      return false
    }
    if (text.startsWith('null', i)) {
      i += 4
      return null
    }
    throw new SyntaxError(`JSON 中存在无法识别的值（位置 ${i}）`)
  }

  function parseArray() {
    const arr = []
    i += 1 // [
    skipWs()
    if (text[i] === ']') {
      i += 1
      return arr
    }
    for (;;) {
      skipWs()
      arr.push(parseValue())
      skipWs()
      if (text[i] === ',') {
        i += 1
        continue
      }
      if (text[i] === ']') {
        i += 1
        return arr
      }
      throw new SyntaxError(`JSON 数组缺少逗号或右括号（位置 ${i}）`)
    }
  }

  function parseObject() {
    const obj = {}
    i += 1 // {
    skipWs()
    if (text[i] === '}') {
      i += 1
      return obj
    }
    for (;;) {
      skipWs()
      if (text[i] !== '"') throw new SyntaxError(`JSON 对象键必须是字符串（位置 ${i}）`)
      const key = parseString()
      skipWs()
      if (text[i] !== ':') throw new SyntaxError(`JSON 对象缺少冒号（位置 ${i}）`)
      i += 1
      skipWs()
      obj[key] = parseValue()
      skipWs()
      if (text[i] === ',') {
        i += 1
        continue
      }
      if (text[i] === '}') {
        i += 1
        return obj
      }
      throw new SyntaxError(`JSON 对象缺少逗号或右大括号（位置 ${i}）`)
    }
  }

  function parseValue() {
    skipWs()
    const c = text[i]
    if (c === '{') return parseObject()
    if (c === '[') return parseArray()
    if (c === '"') return parseString()
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber()
    return parseLiteral()
  }

  const value = parseValue()
  skipWs()
  if (i !== n) throw new SyntaxError(`JSON 结尾存在多余字符（位置 ${i}）`)
  return value
}
