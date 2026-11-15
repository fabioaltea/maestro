import { record } from '../shared/validation.ts';
import { sequence } from '../shared/activity-contract.ts';
/** Connection-local sequence guard; bounded duplicate identity checks, never a persisted checkpoint. */
export class ReplaySequence {
 private received:bigint;private seen=new Map<string,string>();
 constructor(after:string){this.received=BigInt(sequence(after));}
 accept(seq:string,eventId:string){
  const n=BigInt(sequence(seq));
  if(n<=this.received){const known=this.seen.get(seq);if(known&&known!==eventId)throw new Error('STREAM_GAP');return false;}
  if(n!==this.received+1n)throw new Error('STREAM_GAP');
  this.received=n;this.seen.set(seq,eventId);if(this.seen.size>500)this.seen.delete(this.seen.keys().next().value!);return true;
 }
}
export function gapBounds(value:unknown,storeId:string){
 const p=record(value),firstAvailable=sequence(p.firstAvailable),highWater=sequence(p.highWater);
 if(p.storeId!==storeId||BigInt(firstAvailable)<1n||BigInt(firstAvailable)>BigInt(highWater)+1n)throw new Error('STREAM_GAP');
 return{firstAvailable,highWater};
}
