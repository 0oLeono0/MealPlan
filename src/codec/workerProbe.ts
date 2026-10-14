// Diagnostic protocol only. Business DTOs from §13 belong to subsequent tasks.
export type ProbeRequest = { kind: 'probe'; value: '9007199254740993' };
export type ProbeResponse = { kind: 'probe-ready'; protocol: 1; arithmetic: 'bigint'; doubled: string };

export function isProbeRequest(value: unknown): value is ProbeRequest {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'probe'
    && 'value' in value && value.value === '9007199254740993';
}

export function isProbeResponse(value: unknown): value is ProbeResponse {
  return typeof value === 'object' && value !== null
    && 'kind' in value && value.kind === 'probe-ready'
    && 'protocol' in value && value.protocol === 1
    && 'arithmetic' in value && value.arithmetic === 'bigint'
    && 'doubled' in value && value.doubled === '18014398509481986';
}
