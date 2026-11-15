import type { Connection } from '../state/activity-stream.ts';
export function ActivityContinuity({connection,reconnect,reread}:{connection:Connection;reconnect:()=>void;reread:()=>void}){
 if(connection.state==='IDLE')return <p className="hint">Nuova finestra di storia disponibile. Il cursore non viene conservato tra aperture dell’app.</p>;
 if(connection.state==='LIVE'||connection.state==='CONNECTING')return null;
 const gap=connection.state==='GAP';
 return <div className="continuity" role="status"><p>{gap?'Continuità non verificata. Rileggi lo stato e apri una nuova finestra di storia.':'Connessione interrotta. La ripresa è esplicita dall’ultimo cursore confermato.'}{connection.firstAvailable?` Primo evento disponibile: ${connection.firstAvailable}; limite noto: ${connection.highWater}.`:''}</p>
 {gap?<button className="button" onClick={reread}>Rileggi stato e storia</button>:<button className="button" onClick={reconnect}>Riconnetti</button>}</div>;
}
