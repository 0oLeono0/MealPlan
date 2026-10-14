import { describe, expect, it } from 'vitest';
import { probeReducer } from './probeState';

describe('diagnostic controller transitions', () => {
  it('only applies results during a check, and supports retry after failure', () => {
    expect(probeReducer('idle', 'success')).toBe('idle');
    const checking = probeReducer('idle', 'start');
    expect(checking).toBe('checking');
    const failed = probeReducer(checking, 'failure');
    expect(failed).toBe('error');
    expect(probeReducer(probeReducer(failed, 'start'), 'success')).toBe('ready');
    expect(probeReducer('ready', 'failure')).toBe('ready');
  });
});
