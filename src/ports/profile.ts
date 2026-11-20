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
