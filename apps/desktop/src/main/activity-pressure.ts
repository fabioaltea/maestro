/** Client limits do not increase any core queue or throughput guarantee. */
export const STREAM_LIMITS=Object.freeze({frame:65536,backlog:262144,batchBytes:65536,batchEvents:32,ackMs:2000,stderr:16384});
export function assertBacklog(bytes:number){if(bytes>STREAM_LIMITS.backlog)throw new Error('STREAM_SATURATED');}
