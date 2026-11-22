# Verifica del piano — feature 001

**Data**: 2026-11-08
**Ambito**: review documentale di [plan.md](plan.md) e artefatti di design rispetto a
[spec.md](spec.md) e [Constitution](../../.specify/memory/constitution.md).
**Esito**: lacune documentali corrette; gate runtime e performance ancora da eseguire
nella futura implementazione. Nessun test di prodotto dichiarato superato.

## Lacune rilevate e correzioni

| Punto | Gravità prima della correzione | Correzione/evidenza |
|-------|-------------------------------|--------------------|
| Contratti CLI e protocollo locale citati ma assenti | Alta: interfacce non implementabili senza altre decisioni | contracts/cli.md e contracts/local-protocol.md: metodi, frame, auth, errori, timeout, codici e cursori |
| Quickstart e prove complete assenti | Alta: nessun percorso riproducibile di accettazione | quickstart.md: comandi futuri, prima slice e matrice SC-001–SC-010/AR |
| Candidato daemon ritardato dopo crash/retry/stop | Alta: poteva attivarsi un vecchio tentativo | LaunchTicket con generation, claim atomico e cancellazione prima dello stop riuscito |
| Finalizzazione e retry di operazioni diverse | Alta: rischio di riprendere un vecchio restart da un nuovo comando | lifecycle.md: stesso ID per prosecuzione, stop esplicito come annullamento sicuro di ticket non reclamato |
| Autorità di controller e daemon durante recovery | Media: due componenti potevano finalizzare la stessa fase | lifecycle.md: separazione fra fasi del controllo e osservazioni/risorse del daemon |
| Fallimento prima dell'accettazione e gestione dei segnali | Media: errori bootstrap o segnali potevano sfuggire al lifecycle | lifecycle.md: NOT_ACCEPTED, diagnostica limitata esplicita, SIGTERM/SIGINT nel percorso controllato |
| Contesto agente non ancora aggiornato | Media: guida futura non allineata al piano | AGENTS.md generato con script della skill e corretto per comandi pianificati e NodeNext |
| Copertura requisito→design→prova non completa | Media: difficile trovare requisiti dimenticati | Matrice sottostante e quickstart.md |

I contratti progettati non aggiungono provider, Agent Runtime, worktree, pnpm o UI.
L'operazione CLI di consultazione di un requestId serve a rendere verificabile l'idempotenza.

## Copertura completa

| Requisito | Copertura nel design | Verifica prevista |
|-----------|---------------------|-------------------|
| FR-001 | Controller/daemon detached e stdio indipendenti | US1-A2, SC-008, chiusura terminale/CLI |
| FR-002 | Canonical path, due lease con ruoli separati, ticket di avvio | US1-A3/A5, SC-003 |
| FR-003 | cli.md: comandi, aiuto, output e codici | Test contratto e SC-010 |
| FR-004 | Readiness dopo claim/recovery, status read-only | US1-A1/A4, SC-001/008 |
| FR-005 | Schema status, freshness/liveness, pendingFinalization | US4-A1/A5, SC-002/010 |
| FR-006 | State machine e autorità distinti | Test unitari transizioni e SC-004 |
| FR-007 | Stop drain/save/exit, niente force | US2-A1/A2, SC-001/006 |
| FR-008 | Restart unico sotto control lease | US2-A3/A4, SC-001/003 |
| FR-009 | RequestId unico, payloadHash, retry storico o riconciliazione | US3-A2, SC-003/004 |
| FR-010 | Commit FULL prima di conferma, esiti autorevoli | US3-A1, SC-004 |
| FR-011 | Fasi durevoli, risorse e ticket riconciliati | US3-A1/A5, SC-004/005 |
| FR-012 | Challenge/exit/absence; PID positivo non autorizza kill | US3-A3, SC-006 |
| FR-013 | Policy esclusiva degli ausiliari Foundation | US2-A4/US3-A3, SC-005/006, AR-002 |
| FR-014 | Schema/integrità/quota e BLOCKED, nessun reset | US3-A4, SC-004/010 |
| FR-015 | Protocollo v1, bootstrap core e inspect read-only | US4-A1/A3, SC-010 |
| FR-016 | UID, directory privata e capability core | US4-A4, SC-006 |
| FR-017 | Azione/target limitati, metodi interni riservati, niente force/reset | US4-A4, SC-006/010 |
| FR-018 | Outbox + seq + journal persistente | E1, US4-A1, SC-007/009 |
| FR-019 | Replay, handoff, floor e gap | E3, US4-A2, SC-007 |
| FR-020 | Errori/nextAction e deadline non cancellante | US4-A5, SC-002/010 |
| FR-021 | Quote fisiche, coda 1 MiB, streaming senza reader lungo | E1/E2, SC-007/009 |
| FR-022 | Report bootstrap e persisted=false | US3-A4, SC-010 |
| NFR-001 | SQLite FULL e fault injection | SC-004 |
| NFR-002 | Deadline separate dai target; worker storage | SC-001/002/005/007 |
| NFR-003 | UDS privato, redazione e test sentinelle | SC-006/008/009 |
| NFR-004 | Budget condiviso e per-client, idle senza polling continuo | SC-009 e test saturazione |
| NFR-005 | Versioni e schema dei contratti | US4-A3, SC-010 |
| NFR-006 | Porte/clock sostituibili e fixture locali | Tutte le suite e matrice quickstart |
| AR-001 | Cinque porte OS, adapter solo macOS, divieti d'import | Review architetturale e contract test delle porte |
| AR-002 | Policy distinta, controller fuori dagli ausiliari | Review e test delle risorse Foundation |
| AR-003 | E1 persist/query, E2 stream bounded, E3 replay/gap | Prove di uscita indipendenti e V1 completo |

## Punti da validare nella futura implementazione

Questi sono rischi e gate espliciti, non risultati già ottenuti né scuse per abbassare i target.

1. **F0: runtime e driver nativo.** Caricare il driver sulla prima piattaforma e bloccare
   le versioni nel lockfile; verificare tutti i metodi SQLite usati per lease/checkpoint.
2. **F1/F2: semantica dei lease.** Verificare esclusione sotto avvio concorrente, crash
   del proprietario e worker guasto. Un lease libero da solo non prova che il vecchio PID sia morto.
3. **F2: disponibilità conservativa.** Un PID vivo non autenticabile può bloccare il recovery,
   anche se riutilizzato. La diagnostica deve indicarlo; non si promette recupero automatico
   di un'identità che la piattaforma scelta non permette di dimostrare.
4. **E1: allocazione fisica.** Dimostrare limiti di outbox, WAL per transazione, sidecar e
   segmenti aperti. Se l'ipotesi di batch/allocazione non tiene, l'incremento non passa:
   correggere la strategia di storage mantenendo le quote della specifica.
5. **E2/E3: handoff e client lenti.** Verificare buffer effettivi, retention durante replay,
   ultima risposta non consegnabile e ripresa senza omissioni silenziose.
6. **V1: performance.** Tutti gli SC sono NOT_RUN; restano richiesti i carichi e i campioni
   della specifica, compreso l'RSS dei worker e il costo del controller durante il controllo.
7. **Accettazione multi-utente.** Il test reale con UID distinti richiede un runner/account
   predisposto; i mock non bastano a dichiarare soddisfatto FR-016.

## Esito della review

Nessun requisito di specifica privo di copertura documentale. I quattro artefatti mancanti
(contratti CLI/IPC, quickstart e contesto agente) sono stati completati. Specifica e Constitution
non modificate. Non è stata creata una lista tasks né iniziata l'implementazione.
La review dell'utente rimane il prossimo punto di controllo.
