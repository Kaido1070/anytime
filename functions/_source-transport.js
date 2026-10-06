import { isPublicImageUrl } from './_image-security.js';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export class SourceTransportError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// One instance per API request, including its background source sync. Budgets
// are shared by retries and redirect hops, never stored across user requests.
export function createSourceFetcher({
  maxRequests = 96, maxBodyBytes = 8 * 1024 * 1024,
  maxTotalBytes = 32 * 1024 * 1024, concurrency = 4,
  timeoutMs = 12_000, deadlineMs = 60_000, requestSignal,
  fetcher = (...args) => globalThis.fetch(...args),
} = {}) {
  let requests = 0, totalBytes = 0, active = 0;
  const queue = [];
  const deadline = Date.now() + deadlineMs;
  const fail = code => new SourceTransportError(code);

  function acquire(signal) {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (active < concurrency) { active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, abort: null };
      entry.abort = () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener('abort', entry.abort, { once: true });
      entry.resolve = () => {
        signal.removeEventListener('abort', entry.abort);
        resolve();
      };
      queue.push(entry);
    });
  }
  function release() {
    const entry = queue.shift();
    if (entry) entry.resolve(); else active--;
  }

  return async function fetchSource(target, options = {}) {
    if (Date.now() >= deadline) throw fail('SOURCE_DEADLINE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(fail('SOURCE_TIMEOUT')),
      Math.min(timeoutMs, deadline - Date.now()));
    const subscriptions = [...new Set([requestSignal, options.signal].filter(Boolean))].map(external => {
      const abort = () => controller.abort(external.reason);
      if (external.aborted) abort();
      else external.addEventListener('abort', abort, { once: true });
      return { external, abort };
    });
    const signal = controller.signal;
    let acquired = false;
    const interrupted = new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    // Attach a handler immediately while waiting for a concurrency slot.
    interrupted.catch(() => undefined);
    const wait = promise => Promise.race([promise, interrupted]);
    try {
      await acquire(signal); acquired = true;
      let current = String(target), method = String(options.method || 'GET').toUpperCase();
      let body = options.body;
      let headers = options.headers || {};
      for (let hop = 0; hop <= 4; hop++) {
        if (signal.aborted) throw signal.reason;
        if (Date.now() >= deadline) throw fail('SOURCE_DEADLINE');
        if (!isPublicImageUrl(current)) throw fail('INVALID_SOURCE_HOST');
        if (++requests > maxRequests) throw fail('SOURCE_REQUEST_LIMIT');
        const pending = fetcher(current, { ...options, method, body, headers, signal, redirect: 'manual' });
        // A late response from a transport ignoring abort must not leak a body.
        Promise.resolve(pending).then(r => { if (signal.aborted) r.body?.cancel().catch(() => undefined); }, () => undefined);
        const response = await wait(pending);
        if (REDIRECTS.has(response.status)) {
          const location = response.headers.get('Location');
          response.body?.cancel().catch(() => undefined);
          if (!location || hop === 4) throw fail('SOURCE_REDIRECT_LIMIT');
          const next = new URL(location, current);
          if (!isPublicImageUrl(next.href)) throw fail('INVALID_SOURCE_HOST');
          if (next.origin !== new URL(current).origin) {
            if (![301, 302, 303].includes(response.status) && body != null) throw fail('SOURCE_CROSS_ORIGIN_BODY');
            headers = new Headers(headers);
            for (const key of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(key);
          }
          if (response.status === 303 && method !== 'HEAD' || [301, 302].includes(response.status) && method === 'POST') {
            method = 'GET'; body = undefined;
            headers = new Headers(headers); headers.delete('content-type'); headers.delete('content-length');
          }
          current = next.href;
          continue;
        }
        let reader;
        const declared = Number(response.headers.get('Content-Length'));
        if (Number.isFinite(declared) && declared > Math.min(maxBodyBytes, maxTotalBytes - totalBytes)) {
          response.body?.cancel().catch(() => undefined);
          throw fail('SOURCE_BODY_LIMIT');
        }
        const chunks = []; let size = 0, chunkCount = 0;
        try {
          reader = response.body?.getReader();
          while (reader) {
            const { done, value } = await wait(reader.read());
            if (done) break;
            if (++chunkCount > 16_384) throw fail('SOURCE_CHUNK_LIMIT');
            size += value.byteLength; totalBytes += value.byteLength;
            if (size > maxBodyBytes || totalBytes > maxTotalBytes) throw fail('SOURCE_BODY_LIMIT');
            chunks.push(value);
          }
        } catch (error) {
          reader?.cancel().catch(() => undefined);
          throw error;
        } finally { reader?.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const resultHeaders = new Headers(response.headers);
        resultHeaders.delete('content-length'); resultHeaders.delete('content-encoding');
        const result = new Response([204, 205, 304].includes(response.status) ? null : bytes,
          { status: response.status, statusText: response.statusText, headers: resultHeaders });
        Object.defineProperty(result, 'url', { value: current });
        return result;
      }
      throw fail('SOURCE_REDIRECT_LIMIT');
    } finally {
      clearTimeout(timer);
      for (const { external, abort } of subscriptions) external.removeEventListener('abort', abort);
      if (acquired) release();
    }
  };
}
