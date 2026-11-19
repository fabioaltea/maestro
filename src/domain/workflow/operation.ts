export interface WorkflowOperation {
 readonly requestId:string;readonly namespace:'FEATURE'|'ARTIFACT';readonly action:string;readonly phase:'ACCEPTED'|'WORKING'|'FINALIZED';
 readonly outcome:'IN_PROGRESS'|'SUCCEEDED'|'FAILED'|'BLOCKED'|'INTERRUPTED'|'UNKNOWN';readonly targetId:string|null;
 readonly acceptedAt:string;readonly completedAt:string|null;readonly result:Readonly<Record<string,unknown>>|null;readonly error:string|null;
}
