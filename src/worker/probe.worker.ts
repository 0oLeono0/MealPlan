import { isProbeRequest } from '../codec/workerProbe';
import type { ProbeResponse } from '../codec/workerProbe';

const scope: DedicatedWorkerGlobalScope = self;
scope.onmessage = (event: MessageEvent<unknown>) => {
  if (!isProbeRequest(event.data)) return;
  // Verify native BigInt availability, without introducing domain arithmetic.
  const doubled = (BigInt(event.data.value) * 2n).toString();
  const response: ProbeResponse = { kind: 'probe-ready', protocol: 1, arithmetic: 'bigint', doubled };
  scope.postMessage(response);
};
