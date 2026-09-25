import test from 'node:test'
import assert from 'node:assert/strict'

import { canonicalInteger, parseLosslessJson, parseReadings } from './api.js'

const MAX_SAFE = 9007199254740991 // 2^53 − 1

test('安全范围内的整数仍是 number，结构完整保留', () => {
  const body = parseLosslessJson(
    '{"target":10,"sigma":2,"stable":true,"violation":null,' +
      '"limits":{"center":10,"ucl_3s":16},"points":[{"index":0,"value":-5}]}',
  )
  assert.equal(body.target, 10)
  assert.equal(typeof body.target, 'number')
  assert.equal(body.sigma, 2)
  assert.equal(body.stable, true)
  assert.equal(body.violation, null)
  assert.deepEqual(body.limits, { center: 10, ucl_3s: 16 })
  assert.equal(body.points[0].index, 0)
  assert.equal(body.points[0].value, -5)
})

test('2^53−1 仍是安全 number；2^53 及以上解析为 BigInt', () => {
  const body = parseLosslessJson(
    `{"a":${MAX_SAFE},"b":${MAX_SAFE + 1},"c":9007199254740993,"d":-9007199254740992}`,
  )
  assert.equal(body.a, MAX_SAFE)
  assert.equal(typeof body.a, 'number')
  assert.equal(body.b, 9007199254740992n)
  assert.equal(body.c, 9007199254740993n)
  assert.equal(body.d, -9007199254740992n)
})

test('相邻大整数在解析后仍可区分（不被舍入成同一个值）', () => {
  const body = parseLosslessJson('[9007199254740993,9007199254740994]')
  assert.notEqual(body[0], body[1])
  assert.equal(body[0] + 1n, body[1])
})

test('浮点与指数形式仍是 number，字符串内容不被当作数字', () => {
  const body = parseLosslessJson('{"f":1.5,"e":1e2,"s":"9007199254740993","z":0}')
  assert.equal(body.f, 1.5)
  assert.equal(typeof body.f, 'number')
  assert.equal(body.e, 100)
  assert.equal(body.s, '9007199254740993')
  assert.equal(body.z, 0)
})

test('字符串中的转义与 Unicode 正常解析', () => {
  const body = parseLosslessJson('{"msg":"a\\nb\\u0041\\"\\\\","arr":[1,2]}')
  assert.equal(body.msg, 'a\nbA"\\')
  assert.deepEqual(body.arr, [1, 2])
})

test('422 风格的 detail 数组同样无损解析', () => {
  const body = parseLosslessJson(
    '{"detail":[{"type":"int_type","loc":["body","target"],"msg":"应为整数"}]}',
  )
  assert.equal(body.detail[0].loc[1], 'target')
})

test('非法 JSON（尾随字符/前导零/未闭合字符串）抛出 SyntaxError', () => {
  assert.throws(() => parseLosslessJson('1 2'), SyntaxError)
  assert.throws(() => parseLosslessJson('01'), SyntaxError)
  assert.throws(() => parseLosslessJson('"abc'), SyntaxError)
})

test('canonicalInteger 去掉符号与前导零但保留数值身份', () => {
  assert.equal(canonicalInteger('9007199254740993'), '9007199254740993')
  assert.equal(canonicalInteger('+007'), '7')
  assert.equal(canonicalInteger('-009007199254740993'), '-9007199254740993')
  assert.equal(canonicalInteger('0'), '0')
  assert.equal(canonicalInteger('-0'), '0')
  assert.equal(BigInt(canonicalInteger('009007199254740993')), 9007199254740993n)
})

test('parseReadings 保留大整数读数原文身份（不转 Number）', () => {
  const values = parseReadings('9007199254740993, -9007199254740993\n+1 002')
  assert.deepEqual(values, ['9007199254740993', '-9007199254740993', '1', '2'])
  assert.throws(() => parseReadings('1 2.5'), /不是整数/)
})
