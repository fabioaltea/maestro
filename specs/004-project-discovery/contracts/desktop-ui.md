# Contract — Discovery desktop v1

Estende il client003: renderer senza Node, main passa soltanto CLI JSON a Node26 esterno. Nessun provider dentro Electron, niente shell generica. Entrata nel dettaglio del progetto: pannello Discovery con stato Non avviata/In corso/Attende risposta/Da approvare/Approvata/Da aggiornare/Interrotta/Esito incerto, data e motivazione.

## API nominate

Aggiungere al bridge003 (stesso envelope/owner/main frame/origine/epoch/store):

- `chooseProviderBinary`: picker nativo file, handle opaco main-bound; mai path/binario da renderer.
- `getDiscoveryProvider`, `checkDiscoveryProvider`: rispettivamente dati cached e probe locale intenzionale.
- `prepareDiscoveryAction`, `confirmDiscoveryAction`, `cancelDiscoveryAction`: allowlist configure/preview/discard/start/answer/correct/approve/cancel, parametri e versioni chiusi; core grant distinto dalla conferma UI.
- `listDiscoveries`, `getDiscovery`, `getDiscoveryPreview`, `getDiscoveryOutput`, `getDiscoveryQuestions`, `getDiscoveryDocument`, `getDiscoveryEligibility`, `getDiscoveryOperation`: pagine chiuse con IDs/cursor; niente contenuti arbitrari o path file.

La UI sceglie scope da percorsi relativi al progetto, massimo16, non full filesystem. Input bridge32KiB/envelope codificato, massimo8IPC pendenti e2read CLI esistenti; pagine raw8KiB. Il core resta l’autorità per scope/grant/CAS, anche per un client headless alternativo.

## Flusso

1. **Provider**: selezione/configurazione intenzionale del binario e modello; versione/capability/auth e checkedAt. Login gestito dalla CLI ufficiale fuori dalla UI, istruzioni prive di token. Nessuna installazione o auto-login. Se profilo/G0 non qualificato, avvio disabilitato con causa.
2. **Prepara Discovery**: selezionare scope; preview locale con file/omissioni/byte e messaggio che questi contenuti verranno inviati a Codex scelto. Nessuna chiamata modello in preview.
3. **Avvia Discovery**: riepilogo target/provider/modello/scope/digest, conferma intenzionale; UUID operativo e ricevuta privata prima del confirm core. Mostrare discoveryId/sessionId e stato accettato, senza confonderlo con completamento.
4. **Analisi/intervista**: output normalizzato inerte e bounded, progresso se disponibile, domanda con campo label/errori. «Invia e continua» è esplicito; busy impedisce doppio invio. «Non so» conserva UNKNOWN. Cambio archivio chiude solo letture della vista, non sessione o domande.
5. **Review**: sezioni e provenance leggibili, sorgenti relative e righe, risposte utente, ipotesi e UNKNOWN distinti. Azioni Richiedi correzione / Approva questa revisione. Revisione/digest/contesto nel riepilogo; UNKNOWN da accettare esplicitamente. Dato stale richiede nuova Discovery/anteprima, nessuna forzatura.
6. **Cancel/recovery**: annullamento intenzionale con impatto, esito locale verificato o RECONCILING. Operazioni conserva UUID e query originale; nessun pulsante Retry cieco. Alla riapertura reimpostare archivio e ritrovare Discovery/doc/domande. L’eventuale risultato remoto non verificabile resta dichiarato.

## Ricevute e polling

Namespace `discovery`, action distinta e operationResult dedicato. Non usare il ramo registry di settleReceipt, che assume project operation/action. Receipt prima di ogni effetto, solo metadata4KiB e100file, no risposta/prompt/token/provider-path replayabile; query originale store/namespace corretto dopo crash. Confirmation UI60s/hash/epoch monouso, core grant5min; il minimo resta valido.

Output letto quando la vista è visibile,≤1richiesta/s senza sovrapposizione; eventi metadata fungono da invalidazione e mantengono replay003. Ring500righe/1MiB e troncamento esplicito; documento256KiB caricato a chunk con cap totale, senza duplicare l’intera cronologia. Richiesta cancellata al cambio vista non è fallimento della sessione. No polling di login/modello/provider ogni5s.

## Safety/accessibilità

Tastiera, focus visibile/restituito, Esc annulla conferme, errori associati e stato via testo. Nessun render HTML o link eseguibile da output provider/documenti/fonti. Campo secret assente: token/API key/credential files non attraversano bridge, ricevute o log. Pagine protette da epoch/store/session/run/generation; risposta vecchia non aggiorna il nuovo progetto.

Nessun pannello implementa «Crea feature», terminale, gestione worktree, installazioni, failover, merge o release. Approvata significa conoscenza di progetto approvata sul contesto indicato, non autorizzazione a modificare codice.
