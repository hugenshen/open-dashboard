import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8')

test('new-session navigation uses the DSH uiWorkspace service', () => {
  assert.match(source, /const inject = \[[^\]]*'uiWorkspace'/)
  assert.match(packageJson, /@deepseek-ai\/dsh-client-ui-workspace/)
  assert.doesNotMatch(source, /ctx(?:\?\.)?\.workspaces(?:\?\.)?\.startSession/)
  assert.match(source, /navigation\.startSession\(id\)/)
})

test('report progress stays in the right workspace instead of below the composer', () => {
  assert.match(source, /id: 'od-report-process-bridge'/)
  assert.doesNotMatch(source, /id: 'od-analysis-thought-stream'/)
  assert.doesNotMatch(source, /data-od-joy-dialogue/)
  assert.doesNotMatch(source, /od-joy-dialogue-host/)
})

test('context inspection has a route back to the originating user turn', () => {
  assert.match(source, /function pinContextRoundTrip\(\)/)
  assert.match(source, /data-chat-flow-kind="turn-tail"/)
  assert.match(source, /data-chat-flow-kind="user"/)
  assert.match(source, /aria-label', '返回原问题'/)
  assert.match(source, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/)
  assert.match(source, /pinContextRoundTrip\(\)/)
})
