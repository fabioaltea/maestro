export interface ProfileSourceFile {
 readonly path:string;readonly sha256:string;readonly bytes:number;readonly text:string;
}
export interface ProfileSource {
 readonly alias:string;readonly sourceDigest:string;readonly requiredPermissions:readonly string[];
 readonly identity:string;readonly files:readonly ProfileSourceFile[];
}
export interface ProfileImportPort {
 read(root:string):Promise<ProfileSource>;
}

import type {ProfileKind,ProfileScope,ProfileState} from '../domain/profiles/model.js';
import type {WorkflowAdmission,WorkflowOperationRecord} from './workflow.js';

export interface ProfileRecord {
 readonly entityId:string;readonly kind:ProfileKind;readonly scope:ProfileScope;readonly projectId:string|null;readonly ownerProfileId:string|null;
 readonly alias:string;readonly state:ProfileState;readonly stateRevision:string;readonly revisionId:string|null;readonly updatedAt:string;
}
export interface ProfileRevision {
 readonly revisionId:string;readonly entityId:string;readonly previousId:string|null;readonly digest:string;readonly artifactId:string|null;
 readonly byteLength:number;readonly document:Readonly<Record<string,unknown>>;readonly createdAt:string;
}
export interface ProfileResolution {
 readonly resolutionId:string;readonly profileId:string;readonly revisionId:string;readonly projectId:string;readonly projectRevision:string;
 readonly capabilityDigest:string;readonly digest:string;readonly dependencyVersions:readonly {entityId:string;revisionId:string;stateRevision:string}[];
 readonly snapshot:Readonly<Record<string,unknown>>;readonly createdAt:string;
}
export interface ProfilePreview {
 readonly previewId:string;readonly scope:ProfileScope;readonly projectId:string|null;readonly ownerProfileId:string|null;readonly alias:string;
 readonly sourceDigest:string;readonly identity:string;readonly sourcePath:string;readonly artifactId:string;readonly artifactDigest:string;
 readonly byteLength:number;readonly files:readonly Omit<ProfileSourceFile,'text'>[];readonly requiredPermissions:readonly string[];readonly expiresAtMs:number;
}
export type ProfileQuery=
 {readonly kind:'record'|'revision'|'resolution'|'preview'|'artifact';readonly id:string}
 |{readonly kind:'list';readonly projectId:string|null;readonly entityKind:ProfileKind;readonly offset?:number;readonly limit?:number};
export interface ProfileRead {
 readonly record?:ProfileRecord|null;readonly revision?:ProfileRevision|null;readonly resolution?:ProfileResolution|null;
 readonly preview?:ProfilePreview|null;readonly artifact?:{readonly sha256:string;readonly bytes:number}|null;
 readonly records?:readonly ProfileRecord[];readonly nextOffset?:number|null;readonly storeRevision?:string;
}
export type ProfileWrite=
 |{readonly kind:'record';readonly admission:WorkflowAdmission;readonly record:ProfileRecord;readonly revision?:ProfileRevision;
   readonly priorStateRevision?:string;readonly dependencies?:ProfileResolution['dependencyVersions'];readonly previewId?:string}
 |{readonly kind:'resolution';readonly admission:WorkflowAdmission;readonly resolution:ProfileResolution}
 |{readonly kind:'preview';readonly admission:WorkflowAdmission;readonly preview:ProfilePreview};
export interface ProfileStoragePort {
 readProfileState?(query:ProfileQuery):Promise<ProfileRead>;
 commitProfileState?(change:ProfileWrite):Promise<{operation:WorkflowOperationRecord;inserted:boolean}>;
}
