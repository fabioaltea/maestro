# Release readiness004 — T054

Data2026-11-18 · branch004-project-discovery · **Readiness globale: BLOCKED**.
Implementazione locale fino aT054; T028 eT050 restano aperti per il percorso
ufficiale Codex/Keychain. Nessuna dichiarazione di MVP reale completato.

## Decisione e gate

| Ambito | Esito | Evidenza / limite |
|---|---|---|
| Baseline automatica core001–004 | ultimo1FAIL non riprodotto |583test:576PASS/1FAIL/6SKIP; REGISTER isolatoPASS. Precedente suite576PASS/0FAIL/6SKIP; [validation](validation.md) |
| Baseline desktop003–004 | PASS locale |39unit/contract,29integration e34E2EPASS/1SKIP reale senza opt-in |
| G0 pin e confine sintetico | PASS sintetico |[provider-qualification](provider-qualification.md); non dimostra login/account |
| G1 reale/T028 | BLOCKED |precheck autorizzato UNSAFE/PROVIDER_UNSAFE; [metadata](real-provider-status.json) |
| G2 lifecycle/recovery | PASS fixture locale |host/provider come veri processi, SIGKILL, cancel, UI reopen; T036 |
| G3 review/approval | PASS fixture locale |flusso completo nel core, UI review/approval con revisioni fixture; T043 |
| G4 refresh/storico | PASS fixture locale |nuovo ciclo nel core, UI stale/nuova anteprima; T049 |
| SC-001 reale/T050 | NOT_RUN dopo precheck BLOCKED |nessuna inferenza avviata; runner finale1FAIL esprime il blocco |
| Review umana004 | NOT_RUN |test tastiera/visuali automatici non sostituiscono revisione umana |
| Gate001/T082,001/T085,002/T093 | invariati/aperti |runner esterni UID/macchina/IP-denied non qualificati da004 |
| Review umana003/T054 | NOT_RUN/invariata |picker mock e test automatici004 non chiudono la procedura003 |

La qualifica G3/G4 è distribuita: processi fixture nel core headless e viste UI
su stato persistito. Non è un unico percorso UI/provider reale. La provenienza
verifica riferimenti, non la verità semantica. La disponibilità del modello sul
proprio account e il refresh delle credenziali restano non qualificati.

## Tracciabilità dei15scenari

Nomi abbreviati dei test sotto `tests/{unit,contract,integration,acceptance}` e
`apps/desktop/tests/{unit,contract,integration,e2e}`; esecuzioni e conteggi in [validation](validation.md).
PASS locale indica solo fixture e piattaforma qualificata.

| Scenario | Evidenza principale | Esito |
|---|---|---|
| US1.1 consenso e singola sessione |`discovery-start.test.ts`, `discovery-cli-start.test.ts`, E2E`discovery-start`; real-provider |PASS locale / realeBLOCKED |
| US1.2 provider/auth/capability assenti |contratti`discovery-capabilities`, `discovery-codex`, E2Estart, precheck reale |PASS blocco / G1BLOCKED |
| US1.3 doppio invio/occupata |`discovery-admission-store`, `discovery-start`, `discovery-cli-start`, desktop receipts |PASS locale |
| US1.4 dirty/conflitti/unborn readonly |`discovery-context`, `discovery-start`, G0 boundary |PASS locale |
| US2.1 stato/output correlati |`discovery-output`/`discovery-events`, `discovery-cli-interview`, desktop session |PASS locale |
| US2.2 domanda persistente/risposta unica |`discovery-interview`, `discovery-cli-interview`, E2Einterview |PASS locale |
| US2.3 chiusura/riapertura |`discovery-recovery`, E2Einterview/recovery, desktop receipts |PASS locale |
| US2.4 cancel/errore/restart |`discovery-agent-host`, `discovery-lifecycle`, `discovery-recovery`, privacy timeout |PASS locale |
| US3.1 sezioni/provenance/fonti |unit`discovery-documents`, integration`discovery-revisions`, acceptance`discovery-review`, E2Ereview |PASS fixture; realeNOT_RUN |
| US3.2 correzione/nuova revisione |`discovery-revisions`, acceptance`discovery-review`, E2Ereview |PASS fixture |
| US3.3 approvazione precisa core |contratto`discovery-approval`, `discovery-cli-review`, E2Eapproval |PASS fixture |
| US3.4 idoneità incompleta/stale negata |`discovery-eligibility`, `discovery-eligibility-checks`, `discovery-freshness` |PASS locale |
| US4.1 contesto/config/documento diversi |`discovery-context`, `discovery-freshness`, `discovery-revisions`, acceptance`discovery-refresh` |PASS locale |
| US4.2 risultato tardivo |`discovery-freshness`, `discovery-agent-host`, desktop`discovery-epoch`, acceptance refresh |PASS locale |
| US4.3 remove/reimport/altro archivio |`discovery-project-identity`, desktop epoch/receipts, E2Eprivacy/project-actions |PASS locale |

## Requisiti funzionali

| Requisito | Controllo implementato / evidenza | Stato |
|---|---|---|
| FR-001 |core start/headless/UI e profilo Architect; start/CLI/E2E |localePASS; provider realeBLOCKED |
| FR-002 |snapshot/ambito/provider/modello nel grant e conferma, ricevuta pre-effetto |PASS locale |
| FR-003 |porte agnostiche, capacità esplicite, errori normalizzati, no native resume |PASS contratto; login realeBLOCKED |
| FR-004 |corpus sigillato e profilo OS, tool inattesi rifiutati, repo invariato |G0PASS; reale non avviato |
| FR-005 |ledger atomico/UUID, slot unico incluso WAITING_USER/RECONCILING |PASS admission/start/interview |
| FR-006 |Discovery/run/operation distinti; exit0 non approva |PASS state/metadata/revisions |
| FR-007 |output persistente correlato/bounded, domande/risposte e testo inerte |PASS output/interview/desktop |
| FR-008 |ANSWER/UNKNOWN espliciti, revisioni append-only e portable history |PASS interview/CLI/G3fixture |
| FR-009 |tre sezioni obbligatorie, UNKNOWN/NOT_APPLICABLE espliciti |PASS documents; qualità realeNOT_RUN |
| FR-010 |source/hash/righe/quote e answerId/revision verificati, bundle immutabili |PASS documents/revisions/G3fixture |
| FR-011 |correzione crea nuovo run/revisione, approval CAS e UNKNOWN esatti |PASS approval/CLI/E2E |
| FR-012 |eligibility asincrona false di default, no feature API |PASS eligibility/checks |
| FR-013 |fingerprint prima run/publish/approve/check, config/provider CAS nel writer |PASS context/freshness/refresh |
| FR-014 |client disconnect lascia lavoro, riapertura e namespace receipts |PASS recovery/E2E/epoch |
| FR-015 |host owned/GO/prova firmata, nessun kill/adoption da PID storico |PASS agent-host/lifecycle/recovery |
| FR-016 |cancel locale≤4s, ownership incerta preservata; remoto dichiarato non verificato |PASS host/recovery/CLI/interview |
| FR-017 |nuova Discovery esplicita, storico e approvazioni separati per identità |PASS project-identity/G4fixture/E2E |
| FR-018 |canary fuori argv/log/outbox/ricevute/errori, no raw stderr |PASS boundary/privacy/bridge/receipts |

## Requisiti non funzionali

| Requisito | Evidenza | Stato |
|---|---|---|
| NFR-001 local-first |documenti/domande/approval e query offline senza provider |PASS offline/CLI/G3/G4 |
| NFR-002 architettura |stesso daemon/writer, porte dominio, Electron senza driver/provider; lint/build |PASS locale |
| NFR-003 limiti |cap documenti256KiB, chunk8KiB/frame32KiB,20domande/turni,200claim, slot1, output bounded; deadline/fault |PASS casi mirati; target non garanzie generali |
| NFR-004 test indipendenti e reale separato |fixture senza credenziali; runner ufficiale distinto; ultimo test REGISTER non riprodotto |Discovery localePASS / regressione generale aperta / realeBLOCKED |
| NFR-005 UX/tastiera |start/interview/review/approve/cancel, testo inerte, focus/Escape, errori |PASS automatico / umanoNOT_RUN |

## Criteri di successo

| Criterio | Evidenza / limite | Stato |
|---|---|---|
| SC-001 |runner UI ufficiale con consenso, fermato prima inferenza dal precheck Keychain |NOT_RUN; G1BLOCKED |
| SC-002 |tre sezioni e provenance strutturale verificate su fixture; nessuna verità semantica dedotta |PASS fixture / stesso percorso realeNOT_RUN |
| SC-003 |UUID originali, risposte perse, reopen, restart, run count e slot |PASS locale |
| SC-004 |approval esatta e freshness, altre revisioni/identità/context negati |PASS locale |
| SC-005 |snapshot invariati nei percorsi fixture e precheck reale; scope e attacchi negativi G0 |PASS locale / analisi realeNOT_RUN |
| SC-006 |assenza/auth/capability/quota/parser normalizzati, blocco reale osservato correttamente |PASS contratto/blocco; interazione modello realeNOT_RUN |
| SC-007 |tastiera e limiti/privacy automatici, tempi osservati separati dai target |PASS locale / review umanaNOT_RUN |

## Otto invarianti costituzionali

| Invariante | Evidenza e valutazione |
|---|---|
| I Local-first |SQLite/artefatti locali e letture offline; PASS locale |
| II Core headless/client |runtime e gate nel core, CLI/IPC/UI sostituibili; lint e regressioniPASS |
| III Provider agnostic |porte e dominio neutrali, adapter Codex isolato, capacità false se ignote; PASS contratto, realeBLOCKED |
| IV Git safety |readonly OS/corpus, snapshot invariati; worktree/merge N/A in004; PASS G0/fixture |
| V Recovery |intenti durabili, handle posseduti/prove firmate, unknown conserva ownership/slot; PASS fault locali |
| VI Approvazioni esplicite |grant precisi, consent UI, approval CAS e nessuna eredità; reale avviato solo dopo consenso e bloccato dal precheck; PASS gate |
| VII Testabilità |test RED prima delle implementazioni, fixture e fault/clock, reale separato; PASS locale, reale non sostituibile |
| VIII Osservabilità |UUID/stati/output correlati, diagnostica statica/redatta/bounded; PASS locale |

## Aperture e limiti di rilascio

- Regressione generale: ultimo run583test con576PASS/1FAIL/6SKIP. REGISTER
  `project.probing/clean` ha osservato revisione store50 anziché49 durante replay;
  lo stesso caso passa isolato1/1. Causa non determinata, asserzione conservata,
  nessuna promozione a PASS dell’ultimo run. Il precedente run completo era PASS.
- T028/T050: isolare compatibilità del login ufficiale Keychain con il profilo OS;
  correggere e riqualificare prima di ripetere l’inferenza sintetica già autorizzata.
  Nessuna evidenza autorizza API key/fallback, lettura token o allentamenti per passare.
- SC-001 e qualità del documento/modello reale non dimostrati. Revisioni fixture e
  test desktop non sono una certificazione del provider ufficiale.
- Review umana004 e procedura003/T054 non eseguite. Gate esterni001/002 invariati.
- L’eligibility è una fotografia TTL30s, non un’autorizzazione futura. Una futura
  API feature dovrà rivalidare; nessuna atomicità filesystem+SQLite è promessa.
- Nessuna nuova garanzia generale di performance, throughput o durata LLM. Nessun
  acceptance idle/bench:foundation eseguito per004. Output/history restano privati e bounded.

In reviewT054 corretto anche il limite dei check eligibility dopo timeout: il
debito1/progetto/4globale rimane occupato finché l’I/O reale termina.8test mirati
PASS includono G3/G4 e la nuova regressione; timeout test può solo ridurre il
limite30s. Nessun risultato tardivo sovrascrive UNKNOWN.

T054 chiude la review documentale con esitoBLOCKED; non chiude i gate aperti.
Nessun merge, push, release, export Git o fase successiva eseguita.
