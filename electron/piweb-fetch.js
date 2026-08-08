// piweb-fetch.js - 轻量 HTTP 封装（调 pi-web 内部 API）
// 用于插件管理面板等桌面壳功能。只允许 127.0.0.1 回环。
const http = require('node:http');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

function requestJson(url, { method = 'GET', body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new Error(`invalid URL: ${error.message}`));
      return;
    }
    const host = target.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      reject(new Error(`refusing non-loopback target: ${host}`));
      return;
    }

    const payload = body === null ? null : JSON.stringify(body);
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method,
        headers: {
          ...(payload === null ? {} : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode || 0;
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error(`response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          let parseError = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (error) {
              parseError = new Error(`response is not JSON: ${error.message}`);
            }
          }
          if (parseError) {
            reject(parseError);
            return;
          }
          if (status < 200 || status > 299) {
            // pi-web 错误响应形如 { error: "..." }
            const message = data && typeof data.error === 'string'
              ? data.error
              : `HTTP ${status}`;
            const error = new Error(message);
            error.status = status;
            error.body = data;
            reject(error);
            return;
          }
          resolve(data);
        });
        response.on('error', (error) => {
          response.destroy();
          reject(error);
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      reject(error);
    });
    if (payload !== null) request.write(payload);
    request.end();
  });
}

module.exports = { requestJson };
