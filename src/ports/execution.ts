export type ExecutionProviderId='codex'|'claude';
export interface ExecutionCapabilityInspection {
 readonly providerId:ExecutionProviderId;readonly version:string|null;readonly sha256:string|null;
 readonly configuration:readonly string[];readonly catalogueQualified:false;
 readonly error:'EXECUTION_UNSUPPORTED'|'PROVIDER_UNSAFE'|null;
}
export interface ExecutionObservedTool {readonly type:string;readonly name:string|null}
export interface ExecutionQualificationEvidence {
 readonly pin:boolean;readonly commandBoundary:boolean;readonly observedCatalogue:readonly ExecutionObservedTool[];
 readonly brokers:readonly {readonly type:string;readonly name:string;readonly operation:'SCOPED_WRITE'|'APPROVED_COMMAND'|'QUESTION'}[];
 readonly ownershipProof:boolean;
}
export interface ExecutionQualificationPort{
 inspect(providerId:ExecutionProviderId,path:string,privateRoot:string):Promise<ExecutionCapabilityInspection>;
}
