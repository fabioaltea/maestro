# Policy — Scheduler

## Coda e reservation

Job ID e intent digest idempotenti. Ogni progetto ha FIFO per priorità0..2 (0 più alta); scelta globale round-robin tra progetti idonei, una sola admission per progetto per giro. Dentro un progetto priorità non può affamare per sempre livelli più bassi: dopo4dispatch consecutivi del livello superiore dare un turno al più vecchio idoneo degli altri. Job in WAITING_PROVIDER/WAITING_USER non trattengono un turno di scheduling, ma risorse processo/lease si liberano solo con prove.

Reservation atomica per cap globalRun, classINSTALL/VALIDATE, workspaceWriter e limitDISCOVERY=1. I job INSTALL/VALIDATE consumano anche globalRun. Tutti i run004/005/009 passano lo stesso coordinatore per il budget di processo; non alterare lo slot di sessione Discovery e le sue policy. RESERVED scaduto non equivale a no-spawn. Prima del GO record generation, lease e quota coincidono con run identity.

Parametri default: global4,install2,validate2,write1/workspace,pending128. Aggiornamento limiti verso il basso non uccide run attivi: nuove admission bloccate finché uso scende. Limiti CPU/RAM soft, misurazione5s solo con job attivo; se sampler inaffidabile dichiarare UNKNOWN e usare limiti di concorrenza, non valori0 inventati. Disco usa policy007. Nessuna nuova metrica sostiene benchmark generali.

## Attese e tempo

Persistire notBefore UTC, reason/source e retry counter; usare monotonic deadlines per processi avviati. Restart ricalcola timer e rivalida policy, non avvia in sequenza tutti i wake persi. Clock indietro conserva attesa; clock avanti causa una rivalidazione coalescata prima del dispatch. Reset provider null o stale → WAITING_USER, niente inferenza per sondare disponibilità. Solo probe locale esplicitamente supportato può essere schedulato senza modello e senza login implicito.

Min retry60s, backoff esponenziale fino15min e massimo3tentativi/policy autorizzata, ma errore UNKNOWN_OUTCOME non è retryable. Un timestamp reset è un consiglio, non disponibilità garantita: nuovo tentativo incontra auth/quota/capability → nuovo stato esplicito, non loop.

## Policy e switch

Sticky conserva provider e richiede consenso a una ripresa programmata. Fallback contiene elenco ordinato provider/config revision, capability/permessi richiesti, destinatari dati, limiti di costo/tentativi, feature scope, expiry e revoca. Una policy non abilita un provider non qualificato né amplia permessi/tool. In assenza di grant automatico valido prepare un switch manuale.

Cost-aware compara solo stime con unità/valuta/base comparabile e validUntil dichiarati dall’utente o da fonte supportata; dato mancante/stale, costo abbonamento non comparabile o budget ignoto → COST_UNKNOWN/WAITING_USER. Nessuna API privata o prezzo statico dedotto.

Switch: richiesta stop/checkpoint del vecchio run → prova quiescenza → compatibility check e envelope nuovo → consumo grant/policy revision corrente → nuovo run/generation. Se vecchio processo o effetto remoto incerto, mantenere attesa e debit. Se remoteCancellation non verificabile, dichiarare limite; non affermare che la sola uscita locale abbia annullato lavoro remoto, e bloccare switch che possa duplicare effetti remoti non riconciliabili.
