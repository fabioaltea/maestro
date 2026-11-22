import type {GitIntegrationPort} from '../../src/ports/review.js';

export function failReviewPreflight(adapter:GitIntegrationPort,code:string):GitIntegrationPort{
 return{...adapter,preflight:()=>Promise.reject(new Error(code))};
}
