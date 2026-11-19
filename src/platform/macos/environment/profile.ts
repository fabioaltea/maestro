export const environmentProfile=`(version 1)
(deny default)
(allow sysctl-read)
(allow process-exec (literal (param "NODE")))
(allow file-read-metadata)
(allow file-read-data
  (literal "/")
  (subpath "/usr/lib")
  (subpath "/System")
  (literal "/dev/null")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (literal (param "NODE"))
  (subpath (param "DISTRIBUTION"))
  (subpath (param "WORKSPACE"))
  (subpath (param "STORE"))
  (subpath (param "SCRATCH")))
(allow file-write-data (literal "/dev/null"))
(allow file-write*
  (subpath (param "MODULES"))
  (subpath (param "STORE"))
  (subpath (param "SCRATCH")))
`;
export const loopbackRule='(allow network-outbound (remote ip (param "REGISTRY")))\n';

export function sandboxEnvironmentArgs(paths:{node:string;distribution:string;workspace:string;store:string;scratch:string;modules:string},endpoint?:string){
 const values={NODE:paths.node,DISTRIBUTION:paths.distribution,WORKSPACE:paths.workspace,STORE:paths.store,SCRATCH:paths.scratch,MODULES:paths.modules,
   ...(endpoint?{REGISTRY:endpoint}:{})};
 return [...Object.entries(values).flatMap(([key,value])=>['-D',`${key}=${value}`]),
   '-p',environmentProfile+(endpoint?loopbackRule:''),paths.node];
}

export const validationProfile=`(version 1)
(deny default)
(allow sysctl-read)
(allow process-exec (literal (param "NODE")))
(allow file-read-metadata)
(allow file-read-data
  (literal "/")
  (subpath "/usr/lib")
  (subpath "/System")
  (literal "/dev/null")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (literal (param "NODE"))
  (literal (param "SCRIPT"))
  (subpath (param "WORKSPACE")))
(deny file-read-data (subpath (param "GIT")))
(allow file-write-data (literal "/dev/null"))
`;

export function sandboxValidationArgs(node:string,workspace:string,script:string){
 return ['-D',`NODE=${node}`,'-D',`WORKSPACE=${workspace}`,'-D',`SCRIPT=${script}`,'-D',`GIT=${workspace}/.git`,'-p',validationProfile,node];
}
