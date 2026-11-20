# Qualifica 011

## T004 — G0 del 20 novembre 2026

**5 PASS** su macOS arm64/APFS. Git `2.50.1 (Apple Git-155)`, SHA-256 `492bd04fb367c1d51dce2be4eb6d6778829a3623dc4327318dfcdd81bc4fac2e`, profilo base `43d018cd1163f6593ed8c9e8fca25a529a1912e9e5b1aa01e2ea1593eee3efe1`. La suite usa repository temporanei, Git confinato e sole ref di fixture.

- Osservazione di source sporca e ignored, target in uso o spostato. Le letture usano il profilo Git con scritture negate.
- Guard creato senza force. Il pin prova ad aprire il lock sulla ref durante checkout implicito. Il percorso qualificato prenota con `worktree add --no-checkout` e materializza il tree con `read-tree` dopo verifica di directory e indice iniziali. Hook ostile non eseguito.
- Fast-forward tramite CAS sulla sola ref target, poi verifica distinta di indice e file del guard. Fault prima del CAS conserva l'OID precedente, fault dopo CAS osserva il nuovo OID e rifiuta la sincronizzazione se il guard ha lavoro aggiunto.
- Un target divergente resta intatto. Candidate a due parent, staging registrato nello store, validazioni 007 sul candidate e l'uso del port in un'integrazione reale restano da qualificare.

## T035 — scenari del quickstart

| Scenario | Esito locale | Limite |
| --- | --- | --- |
| US1 | PASS per checkpoint pulito, diff sigillato, replay, invalidazione del grant e archivio offline. | Prove dei check 007 sul candidate NOT_RUN. |
| US2 | PASS per fast-forward confinato su fixture e i fault di ref/guard coperti da G0. | Merge a due parent e pubblicazione con receipt durevole NOT_RUN. |
| US3 | PASS per invarianti puri di esito, cambi di documentazione e cleanup. | Workflow reale di ricalcolo Discovery e cleanup delegato NOT_RUN. |

Capability della build standard per consultazione, preparazione e creazione snapshot e richiesta modifiche tramite CLI. Snapshot subordinato a un checkpoint 009 corrente e quiescente. Consultazione e diff Desktop sono disponibili live e offline. Il CAS nativo resta confinato ai test finché manca il workflow di integrazione con attori 006/007 registrati. Nessun nuovo pin, login, hosting o review umana eseguita.

## Ripresa US1

I controlli 007 sul tree sorgente hanno superato la prova con job host macOS e registry di fixture su loopback. Il diff può essere letto con il target in uso, conservando HEAD e contenuto del checkout esterno. La prenotazione Git per l'integrazione continua a richiedere il target libero. Grant `execution.start` distinto per il feedback, provato con host 009 di fixture. L'host di produzione per correzioni resta subordinato alla qualifica 009.

## Ripresa US2

Sul pin Git Apple già qualificato, il candidate divergente usa `merge-tree` e `commit-tree` in staging. Il sandbox di staging circoscrive le scritture al worktree posseduto, al suo amministrativo e agli oggetti Git. Il tentativo con il comando completo `git merge` richiedeva `packed-refs.lock` ed era bloccato. Il CAS resta limitato alla ref target e al relativo reflog. Il test locale esercita 006, 007 e il recovery senza replica del CAS.
