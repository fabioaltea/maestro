import type {Deadline} from './clock.js';
import type {FilesystemAnchor} from './repository.js';

export interface EnvironmentManagerPin {
 readonly manager:'pnpm';readonly version:string;readonly nodeVersion:string;
 readonly entryDigest:string;readonly distributionDigest:string;readonly nodeDigest:string;readonly profileDigest:string;
 readonly descendants:'DENIED';readonly importMethod:'clone-or-copy';
}
export interface EnvironmentInstallScope {
 readonly workspace:FilesystemAnchor;readonly store:FilesystemAnchor;readonly scratch:FilesystemAnchor;
 readonly registryOrigin:string|null;
 readonly manifestDigest:string;readonly lockDigest:string;
}
export interface EnvironmentInstallResult{
 readonly outcome:'SUCCEEDED'|'FAILED'|'CANCELLED'|'RECONCILING';
 readonly exitVerified:boolean;
 readonly exitCode:number|null;
 readonly error:string|null;
 readonly bytes:number;
}
export interface EnvironmentInstallPort {
 qualification():Promise<EnvironmentManagerPin>;
 install(scope:EnvironmentInstallScope,deadline:Deadline,signal?:AbortSignal):Promise<EnvironmentInstallResult>;
}
