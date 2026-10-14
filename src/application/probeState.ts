export type ProbeState = 'idle' | 'checking' | 'ready' | 'error';
export type ProbeEvent = 'start' | 'success' | 'failure';

export function probeReducer(state: ProbeState, event: ProbeEvent): ProbeState {
  if (event === 'start') return 'checking';
  if (state !== 'checking') return state;
  return event === 'success' ? 'ready' : 'error';
}
