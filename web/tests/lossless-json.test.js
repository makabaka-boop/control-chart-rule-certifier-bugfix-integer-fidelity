import test from 'node:test'
import assert from 'node:assert/strict'

import { parseLossless, parseIntegerToken, stringifyLossless } from '../src/lossless-json.js'

// 2^53 附近的临界整数
const P53 = 9007199254740992n // 2^53（自身可表示，但 2^53+1 不能）
const P53P1 = 9007199254740993n
const N53 = -9007199254740992n
const N53M1 = -9007199254740993n
const HUGE = 1234567890123456789012345678901234567890n
const NHUGE = -HUGE

// 若用 Number/JSON.parse，这些恒等关系就会被破坏
const roundedByDouble = (n) => BigInt(JSON.parse(JSON.stringify(Number(n.toString()))))

test('前置事实：普通 JSON 在临界样本上确实会舍入', () => {
  assert.notEqual(roundedByDouble(P53P1), P53P1)
  assert.notEqual(roundedByDouble(N53M1), N53M1)
})

test('整数字面量解析为 bigint 且任意位数不丢精度', () => {
  assert.equal(parseLossless('9007199254740993'), P53P1)
  assert.equal(parseLossless('-9007199254740993'), N53M1)
  assert.equal(parseLossless('9007199254740992'), P53)
  assert.equal(parseLossless('-9007199254740992'), N53)
  assert.equal(parseLossless('1234567890123456789012345678901234567890'), HUGE)
  assert.equal(parseLossless('-1234567890123456789012345678901234567890'), NHUGE)
  assert.equal(parseLossless('0'), 0n)
  assert.equal(parseLossless('9007199254740991'), 9007199254740991n) // MAX_SAFE_INTEGER
})

test('非结构元素：布尔/null/字符串/小数保持原语义', () => {
  assert.equal(parseLossless('true'), true)
  assert.equal(parseLossless('false'), false)
  assert.equal(parseLossless('null'), null)
  assert.equal(parseLossless('"9007199254740993"'), '9007199254740993')
  assert.equal(parseLossless('1.5'), 1.5)
  assert.equal(parseLossless('1e3'), 1000)
  const body = parseLossless('{"stable":true,"violation":null,"name":"x"}')
  assert.deepEqual(body, { stable: true, violation: null, name: 'x' })
})

test('响应形态：所有整数字段（含数组、嵌套对象）都是同一数值身份', () => {
  // 服务端发出的是裸整数字面量
  const raw = `{
    "target": 9007199254740993,
    "sigma": 9007199254740992,
    "limits": {"center": 9007199254740993, "ucl_3s": 1234567890123456789012345678901234567890},
    "points": [{"index": 0, "value": 9007199254740993, "deviation": -1234567890123456789012345678901234567890}]
  }`
  const parsed = parseLossless(raw)
  assert.equal(parsed.target, P53P1)
  assert.equal(parsed.sigma, P53)
  assert.equal(parsed.limits.center, P53P1)
  assert.equal(parsed.limits.ucl_3s, HUGE)
  assert.equal(parsed.points[0].value, P53P1)
  assert.equal(parsed.points[0].deviation, NHUGE)
  // 确保不是 Number 被静默提升
  assert.equal(typeof parsed.target, 'bigint')
})

test('stringifyLossless：bigint 逐位输出，结构与普通 JSON 一致', () => {
  assert.equal(stringifyLossless(P53P1), '9007199254740993')
  assert.equal(stringifyLossless(NHUGE), '-1234567890123456789012345678901234567890')
  const payload = {
    target: P53P1,
    sigma: 1n,
    readings: [N53M1, P53, HUGE],
  }
  assert.equal(
    stringifyLossless(payload),
    '{"target":9007199254740993,"sigma":1,"readings":[-9007199254740993,9007199254740992,1234567890123456789012345678901234567890]}',
  )
  // 往返：序列化再无损解析，数值身份不变
  const round = parseLossless(stringifyLossless(payload))
  assert.deepEqual(round, payload)
})

test('普通小整数往返与原生 JSON 完全兼容', () => {
  const cases = [0, 1, -1, 42, -9007199254740991n, 9007199254740991n]
  for (const c of cases) {
    const v = typeof c === 'number' ? BigInt(c) : c
    assert.equal(parseLossless(stringifyLossless(v)), v)
  }
  const obj = { a: 1n, b: [2n, -3n], c: 's', d: true, e: null, f: 1.25 }
  assert.equal(
    stringifyLossless(obj),
    JSON.stringify({ a: 1, b: [2, -3], c: 's', d: true, e: null, f: 1.25 }),
  )
})

test('parseIntegerToken 拒绝非整数与非有限格式', () => {
  assert.equal(parseIntegerToken('9007199254740993'), P53P1)
  assert.equal(parseIntegerToken('+7'), 7n)
  assert.equal(parseIntegerToken('-0'), 0n)
  for (const bad of ['1.0', '1e3', '0x1', 'abc', '', ' 1', '1 ', '1.']) {
    assert.throws(() => parseIntegerToken(bad), /不是整数|不是/)
  }
})

test('严格语法：拒绝尾缀、前导零、非法转义等', () => {
  for (const bad of ['1,', '{}x', '01', '- 1', '{"a":}', '[1,]', 'tru', '"a']) {
    assert.throws(() => parseLossless(bad), SyntaxError)
  }
  // 合法但带空白
  assert.deepEqual(parseLossless(' { "a" : [ 1 , 2 ] } '), { a: [1n, 2n] })
})
