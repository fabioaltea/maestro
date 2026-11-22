export type ExecutionOutputEvent=
 |{readonly kind:'TEXT';readonly text:string}
 |{readonly kind:'QUESTION';readonly correlation:string;readonly questions:readonly {readonly id:string;readonly text:string}[]}
 |{readonly kind:'TOOL_REQUEST';readonly correlation:string;readonly name:string;readonly input:Readonly<Record<string,unknown>>}
 |{readonly kind:'COMPLETED'}|{readonly kind:'FAILED'};
export interface ExecutionOutputDecoder {feed(bytes:Uint8Array):readonly ExecutionOutputEvent[];finish():void}
