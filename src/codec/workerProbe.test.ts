import { describe, expect, it } from 'vitest';
import { isProbeRequest, isProbeResponse } from './workerProbe';

describe('Worker diagnostic boundary', () => {
  it('accepts the supported handshake and rejects malformed or incompatible replies', () => {
    expect(isProbeRequest({ kind: 'probe', value: '9007199254740993' })).toBe(true);
    expect(isProbeResponse({ kind: 'probe-ready', protocol: 1, arithmetic: 'bigint', doubled: '18014398509481986' })).toBe(true);
    for (const payload of [null, 'ready', {}, { kind: 'probe-ready' },
      { kind: 'probe-ready', protocol: 2, arithmetic: 'bigint', doubled: '18014398509481986' },
      { kind: 'probe-ready', protocol: 1, arithmetic: 'float', doubled: '18014398509481986' },
      { kind: 'probe-ready', protocol: 1, arithmetic: 'bigint', doubled: '18014398509481984' }]) {
      expect(isProbeResponse(payload)).toBe(false);
    }
    expect(isProbeRequest({ kind: 'generate' })).toBe(false);
  });
});
