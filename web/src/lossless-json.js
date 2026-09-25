/**
 * 无损 JSON：整数字面量（无论多大）一律解析为 bigint，
 * 输出时 bigint 原样写回十进制文本。
 *
 * 这样声明为整数的 target / sigma / readings / limits / deviation
 * 在「输入 → 请求 → 规则判定 → 响应 → 图表」全链路保持同一数值身份，
 * 不再被 JSON.parse 的 IEEE-754 双精度舍入。
 *
 * 非整数（带小数 / 指数 / 1e1000 等）仍按 Number 解析（服务端不会产生）。
 */

function isWs(ch) {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n'
}

/** 把任意 JS 值编码为 JSON 文本；bigint 以精确十进制输出。 */
export function stringifyLossless(value) {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'bigint') return value.toString()
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return quoteString(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stringifyLossless(v))).join(',')}]`
  }
  if (t === 'object') {
    const parts = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${quoteString(k)}:${stringifyLossless(v)}`)
    return `{${parts.join(',')}}`
  }
  // function / symbol 无法忠实序列化，显式报错而非静默丢弃
  throw new TypeError(`无法无损序列化的值：${t}`)
}

function quoteString(s) {
  let out = '"'
  for (const ch of s) {
    switch (ch) {
      case '"': out += '\\"'; break
      case '\\': out += '\\\\'; break
      case '\b': out += '\\b'; break
      case '\f': out += '\\f'; break
      case '\n': out += '\\n'; break
      case '\r': out += '\\r'; break
      case '\t': out += '\\t'; break
      default: {
        const code = ch.codePointAt(0)
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : ch
      }
    }
  }
  return `${out}"`
}

/** 解析 JSON：整数字面量 → bigint，其余数字 → Number。 */
export function parseLossless(text) {
  const s = String(text)
  let i = 0

  function skipWs() {
    while (i < s.length && isWs(s[i])) i += 1
  }

  function parseValue() {
    skipWs()
    const ch = s[i]
    if (ch === '{') return parseObject()
    if (ch === '[') return parseArray()
    if (ch === '"') return parseString()
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber()
    if (s.startsWith('true', i)) { i += 4; return true }
    if (s.startsWith('false', i)) { i += 5; return false }
    if (s.startsWith('null', i)) { i += 4; return null }
    throw new SyntaxError(`意外的 JSON 内容（位置 ${i}）`)
  }

  function parseObject() {
    const obj = {}
    i += 1 // {
    skipWs()
    if (s[i] === '}') { i += 1; return obj }
    for (;;) {
      skipWs()
      if (s[i] !== '"') throw new SyntaxError(`对象键必须是字符串（位置 ${i}）`)
      const key = parseString()
      skipWs()
      if (s[i] !== ':') throw new SyntaxError(`对象缺少冒号（位置 ${i}）`)
      i += 1
      obj[key] = parseValue()
      skipWs()
      if (s[i] === ',') { i += 1; continue }
      if (s[i] === '}') { i += 1; return obj }
      throw new SyntaxError(`对象缺少逗号或右花括号（位置 ${i}）`)
    }
  }

  function parseArray() {
    const arr = []
    i += 1 // [
    skipWs()
    if (s[i] === ']') { i += 1; return arr }
    for (;;) {
      arr.push(parseValue())
      skipWs()
      if (s[i] === ',') { i += 1; continue }
      if (s[i] === ']') { i += 1; return arr }
      throw new SyntaxError(`数组缺少逗号或右方括号（位置 ${i}）`)
    }
  }

  function parseString() {
    let out = ''
    i += 1 // 开引号
    while (i < s.length) {
      const ch = s[i]
      if (ch === '"') { i += 1; return out }
      if (ch === '\\') {
        i += 1
        const e = s[i]
        if (e === 'u') {
          const hex = s.slice(i + 1, i + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new SyntaxError(`非法 \\u 转义（位置 ${i}）`)
          }
          let code = parseInt(hex, 16)
          i += 5
          if (code >= 0xd800 && code <= 0xdbff && s[i] === '\\' && s[i + 1] === 'u') {
            const hex2 = s.slice(i + 2, i + 6)
            if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
              const low = parseInt(hex2, 16)
              if (low >= 0xdc00 && low <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
                i += 6
              }
            }
          }
          out += String.fromCodePoint(code)
        } else {
          const simple = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '"': '"', '/': '/', '\\': '\\' }
          if (!(e in simple)) throw new SyntaxError(`非法转义 \\${e}（位置 ${i}）`)
          out += simple[e]
          i += 1
        }
      } else {
        if (ch.codePointAt(0) < 0x20) throw new SyntaxError(`字符串中存在未转义控制字符（位置 ${i}）`)
        out += ch
        i += ch.length > 1 ? ch.length : 1
      }
    }
    throw new SyntaxError('字符串未闭合')
  }

  function parseNumber() {
    const start = i
    if (s[i] === '-') i += 1
    if (s[i] === '0') {
      i += 1
      if (s[i] >= '0' && s[i] <= '9') throw new SyntaxError(`非法前导零（位置 ${start}）`)
    } else if (s[i] >= '1' && s[i] <= '9') {
      while (s[i] >= '0' && s[i] <= '9') i += 1
    } else {
      throw new SyntaxError(`非法数字（位置 ${start}）`)
    }

    let isInteger = true
    if (s[i] === '.') {
      isInteger = false
      i += 1
      if (!(s[i] >= '0' && s[i] <= '9')) throw new SyntaxError(`非法小数（位置 ${start}）`)
      while (s[i] >= '0' && s[i] <= '9') i += 1
    }
    if (s[i] === 'e' || s[i] === 'E') {
      isInteger = false
      i += 1
      if (s[i] === '+' || s[i] === '-') i += 1
      if (!(s[i] >= '0' && s[i] <= '9')) throw new SyntaxError(`非法指数（位置 ${start}）`)
      while (s[i] >= '0' && s[i] <= '9') i += 1
    }

    const token = s.slice(start, i)
    if (isInteger) {
      return BigInt(token) // 任意位数整数都不丢精度
    }
    return Number(token)
  }

  const result = parseValue()
  skipWs()
  if (i !== s.length) throw new SyntaxError(`JSON 尾部存在多余内容（位置 ${i}）`)
  return result
}

/**
 * 宽松解析：用于输入文本（readings 逐条、target、sigma）。
 * 仅接受可选符号 + 纯数字的十进制整数，返回 bigint；否则抛错。
 */
export function parseIntegerToken(tok, label = '整数') {
  if (!/^[+-]?\d+$/.test(tok)) {
    throw new Error(`「${tok}」不是${label}`)
  }
  return BigInt(tok)
}
