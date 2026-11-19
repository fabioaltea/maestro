# Policy — Publication & Deployment

## Destinatario e push

Remote ID risolto dalla configurazione progetto approvata; canonico URL/schema/host/repository digest nel piano. Deny remote-ext, file path non autorizzati, URL con credenziali inline, refspec wildcard/deletion/force e config/helper eseguibili non approvati. Auth usa interfacce ufficiali nel processo trusted senza copiare token; SSH/HTTPS helper/host key prompts non risolvibili unattended producono AUTH_REQUIRED, mai auto-accept. Raw stderr/auth output non pubblico.

Source deve essere IntegrationReceipt corrente e commit ancora disponibile. Piano DIRECT distingue expectedRemoteOid osservato e sourceOid: origin avanzato dopo prepare invalida il grant. Push ordinario refspec esplicito, nessun force/force-with-lease implicito. Git può rifiutare non-fast-forward/protezione, che diventano errori normali da risolvere nel workflow PR. La preosservazione remote non è atomicità globale: dopo push osservare la ref; se non corrisponde o attribuzione non provata, REMOTE_UNKNOWN/SATISFIED_ATTRIBUTION_UNKNOWN, non successo falsamente attribuito.

Tag opzionale: tagName assente e sourceOid approvato, grant CREATE_TAG distinto per locale/pubblicazione remota esplicitati nel riepilogo. Collisione tag preservata, nessun move/delete. Pubblicare branch non include automaticamente tag.

## Idempotenza remota e PR/CI

EFFECT_INTENT contiene destinazione, payload digest e UUID marker prima del comando. Timeout dopo possibile invio conserva REMOTE_UNKNOWN. Reconcile remoto osserva ref o cerca marker PR/ID provider. Nessun retry di create/deploy senza lookup idempotente provato. Un ref già in stato desiderato può soddisfare l’obiettivo con attribuzione UNKNOWN distinta da effetto di quella richiesta; se la distinzione è essenziale richiedere intervento.

PR plan: hosting capability, repository ID, base/head ref+OID, title/body artifact digest, marker UUID. Marker unico ricercabile e response ID sono prove, non solo titolo. Doppia PR con marker o API incoerente → blocco, non selezione casuale. Adapter GitHub iniziale tramite gh configurata: path/hash/versione/auth supportata qualificati su G0; no auto-install. GitLab/altri origin possono usare Git-only/manual handoff senza UI finta per PR.

CI observation lega provider run ID, source commit SHA/OID e checkedAt. Stati MISSING/UNKNOWN non sono SUCCEEDED; head PR spostata invalida prove prima di deploy. Polling solo su richiesta follow/job autorizzato con backoff e cap, nessuna rete da lettura offline. Requisiti CI possono essere vuoti soltanto se il piano deployment dichiara esplicitamente che non sono richiesti, mai per indisponibilità di un check obbligatorio.

## Deployment e policy

DeployEnvelope include source commit, artefatto immutabile/digest, environment ID/revision, adapter config/capability, CommandSpec se applicabile, rete/credenziali richieste, controlli CI/precondizioni e limiti. Grant DEPLOY separato da PUSH e CREATE_PR. Nessun adapter qualificato → MANUAL_HANDOFF con istruzioni verificate, non DEPLOYED.

Un adapter deployment automatico deve supportare idempotency key o lookup/status affidabile per il precedente effetto; altrimenti un esito incerto vieta retry automatico e richiede intervento. Comando locale che avvia remoto non prova successo remoto con exit0: il contratto deve dichiarare quale prova lo dimostra. Rollback, force, delete e operazioni distruttive non fanno parte dell’approvazione standard.

Policy opt-in: allowedActions subset esplicito, remote/ref/environment scope, artifact constraints, requiredChecks, uses≤maxUses, expiresAt, revision e revocation. Core rivalida a ogni admission e prima dell’effetto; revoca impedisce nuove azioni e invia cancel solo ai processi owned dove supportato, senza affermare rollback di effetto remoto già avvenuto. Release Manager propone piano ma non detiene credenziali pubblicazione né esegue publish/deploy nel proprio tool shell.
