import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_ENDPOINT_PATH = path.join(os.homedir(), '.dsh', 'agents-anywhere', 'bridge', 'endpoint.json');
const DEFAULT_NAMESPACE = 'dflow-bridge';

export class DshBridgeError extends Error {
  constructor(message, code = 'DSH_BRIDGE_ERROR') {
    super(message);
    this.name = 'DshBridgeError';
    this.code = code;
  }
}

export function bridgeEndpointPath() {
  return process.env.DFLOW_DSH_BRIDGE_ENDPOINT
    ? path.resolve(process.env.DFLOW_DSH_BRIDGE_ENDPOINT)
    : DEFAULT_ENDPOINT_PATH;
}

export function readBridgeEndpoint(filePath = bridgeEndpointPath()) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new DshBridgeError(`找不到 DSH Bridge：${error.code === 'ENOENT' ? '请先启动 DSH Desktop' : error.message}`, 'DSH_BRIDGE_UNAVAILABLE');
  }
  const host = typeof parsed?.host === 'string' && parsed.host.trim() ? parsed.host.trim() : '127.0.0.1';
  const port = Number(parsed?.port);
  const token = typeof parsed?.token === 'string' ? parsed.token : '';
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !token) {
    throw new DshBridgeError('DSH Bridge endpoint 配置无效，请重启 DSH Desktop', 'DSH_BRIDGE_INVALID_ENDPOINT');
  }
  return { host, port, token };
}

function errorMessage(error) {
  if (error instanceof DshBridgeError) return error.message;
  return error?.message || String(error);
}

export class DshBridgeClient {
  constructor(options = {}) {
    this.endpointFile = options.endpointFile || bridgeEndpointPath();
    this.namespace = String(options.namespace || process.env.DFLOW_DSH_BRIDGE_NAMESPACE || DEFAULT_NAMESPACE);
    this.connectTimeoutMs = Number(options.connectTimeoutMs || 4000);
    this.requestTimeoutMs = Number(options.requestTimeoutMs || 15000);
  }

  async request(method, params = {}) {
    const endpoint = readBridgeEndpoint(this.endpointFile);
    const requestId = crypto.randomUUID();
    const initId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let socket;
      let buffer = Buffer.alloc(0);
      let initialized = false;
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket && !socket.destroyed) socket.end();
        if (error) reject(error); else resolve(value);
      };
      const send = (id, rpcMethod, rpcParams) => {
        if (!socket || socket.destroyed) throw new DshBridgeError('DSH Bridge 连接已断开', 'DSH_BRIDGE_DISCONNECTED');
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: rpcMethod, params: rpcParams })}\n`);
      };
      const handle = message => {
        if (message?.jsonrpc !== '2.0') return;
        if (message.method) return; // runtime.sync.batch and runtime.error notifications are not needed here.
        if (message.id !== initId && message.id !== requestId) return;
        if (message.error) {
          const detail = message.error.message || 'DSH Bridge 请求失败';
          finish(new DshBridgeError(detail, message.error.code || 'DSH_BRIDGE_RPC_ERROR'));
          return;
        }
        if (!initialized && message.id === initId) {
          initialized = true;
          try {
            send(requestId, method, params);
          } catch (error) {
            finish(error);
          }
          return;
        }
        if (initialized && message.id === requestId) finish(null, message.result);
      };
      timer = setTimeout(() => finish(new DshBridgeError('DSH Bridge 响应超时，请确认 DSH Desktop 正在运行', 'DSH_BRIDGE_TIMEOUT')), this.requestTimeoutMs);
      timer.unref?.();
      socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
      socket.setTimeout(this.connectTimeoutMs, () => finish(new DshBridgeError('连接 DSH Bridge 超时，请确认 DSH Desktop 正在运行', 'DSH_BRIDGE_TIMEOUT')));
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.setTimeout(0);
        try {
          send(initId, 'initialize', {
            authToken: endpoint.token,
            protocolVersion: '1.0',
            runtime: 'dsh',
            connectorId: this.namespace,
            sessionNamespace: this.namespace
          });
        } catch (error) { finish(error); }
      });
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline;
        while ((newline = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
          buffer = buffer.subarray(newline + 1);
          if (!line) continue;
          try { handle(JSON.parse(line)); }
          catch { finish(new DshBridgeError('DSH Bridge 返回了无效数据', 'DSH_BRIDGE_PROTOCOL_ERROR')); }
        }
      });
      socket.on('timeout', () => finish(new DshBridgeError('DSH Bridge 响应超时，请确认 DSH Desktop 正在运行', 'DSH_BRIDGE_TIMEOUT')));
      socket.on('error', error => finish(new DshBridgeError(`DSH Bridge 连接失败：${errorMessage(error)}`, 'DSH_BRIDGE_UNAVAILABLE')));
      socket.on('close', () => {
        if (!settled) finish(new DshBridgeError('DSH Bridge 提前断开连接', 'DSH_BRIDGE_DISCONNECTED'));
      });
    });
  }

  async listSessions() {
    const result = await this.request('session.list', { limit: 100 });
    return Array.isArray(result?.sessions) ? result.sessions : [];
  }

  async startTurn(sessionId, content) {
    if (!String(sessionId || '').trim()) throw new DshBridgeError('没有可用的 DSH 聊天窗口', 'DSH_SESSION_REQUIRED');
    if (!String(content || '').trim()) throw new DshBridgeError('唤起 DSH 的消息不能为空', 'DSH_MESSAGE_REQUIRED');
    const result = await this.request('session.startTurn', {
      sessionId: String(sessionId),
      content: String(content),
      clientMessageId: crypto.randomUUID()
    });
    if (result?.ok === false) throw new DshBridgeError(result.message || 'DSH 没有接受唤起消息', result.code || 'DSH_TURN_REJECTED');
    return result;
  }
}

export function publicBridgeError(error) {
  return errorMessage(error).replace(/[\r\n]+/g, ' ').slice(0, 500);
}
