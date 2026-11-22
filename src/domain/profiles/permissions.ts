export const PROFILE_PERMISSIONS=['WORKSPACE_READ','WORKSPACE_WRITE','COMMAND_VALIDATE','TOOL_LOCAL','TOOL_MCP','NETWORK_LOOPBACK'] as const;
export type ProfilePermission=typeof PROFILE_PERMISSIONS[number];
export interface ProfilePermissions {
 readonly allow:readonly ProfilePermission[];readonly deny:readonly ProfilePermission[];readonly required:readonly ProfilePermission[];
}
export function parseProfilePermissions(value:unknown):ProfilePermission[]{
 if(!Array.isArray(value)||value.length>PROFILE_PERMISSIONS.length||
   value.some(item=>!(PROFILE_PERMISSIONS as readonly unknown[]).includes(item))||new Set(value).size!==value.length)
   throw new Error('PERMISSION_CONFLICT');
 return PROFILE_PERMISSIONS.filter(permission=>value.includes(permission));
}
export function intersectProfilePermissions(layers:readonly {allow:readonly ProfilePermission[];deny:readonly ProfilePermission[]}[]){
 return PROFILE_PERMISSIONS.filter(permission=>layers.every(layer=>layer.allow.includes(permission)&&!layer.deny.includes(permission)));
}
export function permitsProfilePermissions(allowed:readonly ProfilePermission[],needed:readonly ProfilePermission[]){
 return needed.every(permission=>allowed.includes(permission));
}
