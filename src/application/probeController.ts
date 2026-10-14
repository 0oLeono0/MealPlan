import { isProbeResponse } from '../codec/workerProbe';
import type { ProbeRequest } from '../codec/workerProbe';

export function startWorkerProbe(onResult: (success: boolean) => void): () => void {
  let worker: Worker;
  try {
    worker = new Worker(new URL('../worker/probe.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    onResult(false);
    return () => {};
  }
  let closed = false;
  const close = () => {
    closed = true;
    clearTimeout(timer);
    worker.terminate();
  };
  const finish = (success: boolean) => {
    if (closed) return;
    close();
    onResult(success);
  };
  const timer = setTimeout(() => finish(false), 5000);
  worker.onmessage = (event: MessageEvent<unknown>) => finish(isProbeResponse(event.data));
  worker.onerror = () => finish(false);
  worker.onmessageerror = () => finish(false);
  const request: ProbeRequest = { kind: 'probe', value: '9007199254740993' };
  try { worker.postMessage(request); } catch { finish(false); }
  return close;
}
