import type {ProfileImportPort,ProfileSource} from '../../src/ports/profile.js';

export function profileAdapter(initial:ProfileSource){
 let source=initial;
 const port:ProfileImportPort={async read(){return structuredClone(source);}};
 return{port,replace(value:ProfileSource){source=value;}};
}
