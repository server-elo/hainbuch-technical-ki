import { AsyncLocalStorage } from "node:async_hooks";

/** Signal of the HTTP request that started the current pipeline run. Aborts
 *  when the client disconnects, so no LLM/RAG call keeps burning tokens. */
const store = new AsyncLocalStorage<AbortSignal>();

export function withRequestSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return store.run(signal, fn);
}

/** Timeout signal combined with the client-disconnect signal, if any. */
export function requestSignal(timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  const client = store.getStore();
  return client ? AbortSignal.any([timeout, client]) : timeout;
}

export const clientAborted = (): boolean => store.getStore()?.aborted === true;
