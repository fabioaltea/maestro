import type { Page } from '@playwright/test';
export async function watchVisible(page:Page){
 await page.evaluate(()=>{
  const w=window as unknown as {visibleSamples:{seq:string;visibleAt:number}[];maxSeq:string;observer:MutationObserver};w.visibleSamples=[];w.maxSeq='0';
  const seen=new Set<string>();
  function scan(){for(const el of document.querySelectorAll<HTMLElement>('.event-row')){const seq=el.dataset.eventSeq!;if(BigInt(seq)>BigInt(w.maxSeq))w.maxSeq=seq;if(!seen.has(seq)){seen.add(seq);if(w.visibleSamples.length<1100)w.visibleSamples.push({seq,visibleAt:Date.now()});}}if(seen.size>1000){const keep=[...seen].slice(-500);seen.clear();for(const s of keep)seen.add(s);}}
  w.observer=new MutationObserver(scan);w.observer.observe(document.querySelector('.event-list')!,{childList:true});scan();
 });
}
export async function visibleSamples(page:Page){return page.evaluate(()=>(window as unknown as {visibleSamples:{seq:string;visibleAt:number}[]}).visibleSamples);}
export const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;
