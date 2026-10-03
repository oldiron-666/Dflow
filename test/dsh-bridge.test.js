import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DshBridgeClient } from '../dsh-bridge.js';

const readLines = (socket, onMessage) => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      onMessage(JSON.parse(line));
    }
  });
};

test('DSH bridge performs initialize, session.list and session.startTurn without exposing endpoint credentials', { timeout: 10000 }, async () => {
  const received = [];
  const bridge = net.createServer(socket => {
    readLines(socket, message => {
      received.push(message);
      if (message.method === 'initialize') {
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '1.0' } }) + '\n');
      } else if (message.method === 'session.list') {
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessions: [{ runtime: 'dsh', sessionId: 'sess_dsh_test', title: '测试窗口', metadata: { live: true, readOnly: false } }] } }) + '\n');
      } else if (message.method === 'session.startTurn') {
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\n');
      } else {
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method' } }) + '\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    bridge.once('error', reject);
    bridge.listen(0, '127.0.0.1', resolve);
  });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dflow-dsh-bridge-'));
  const endpointFile = path.join(temp, 'endpoint.json');
  const address = bridge.address();
  await fs.writeFile(endpointFile, JSON.stringify({ host: '127.0.0.1', port: address.port, token: 'test-token' }), 'utf8');
  try {
    const client = new DshBridgeClient({ endpointFile, requestTimeoutMs: 2000 });
    const sessions = await client.listSessions();
    assert.equal(sessions[0].sessionId, 'sess_dsh_test');
    const result = await client.startTurn('sess_dsh_test', '测试唤起消息');
    assert.equal(result.ok, true);
    assert.deepEqual(received.map(message => message.method), ['initialize', 'session.list', 'initialize', 'session.startTurn']);
    assert.equal(received[3].params.sessionId, 'sess_dsh_test');
    assert.equal(received[3].params.content, '测试唤起消息');
    assert.match(received[3].params.clientMessageId, /^[0-9a-f-]{36}$/i);
    assert.equal(JSON.stringify(sessions).includes('test-token'), false);
    assert.equal(JSON.stringify(result).includes('test-token'), false);
  } finally {
    await new Promise(resolve => bridge.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
