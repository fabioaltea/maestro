# Qualifica 011

## T004 — G0 del 20 novembre 2026

**5 PASS** su macOS arm64/APFS. Git `2.50.1 (Apple Git-155)`, SHA-256 `492bd04fb367c1d51dce2be4eb6d6778829a3623dc4327318dfcdd81bc4fac2e`, profilo base `43d018cd1163f6593ed8c9e8fca25a529a1912e9e5b1aa01e2ea1593eee3efe1`. La suite usa repository temporanei, Git confinato e sole ref di fixture.

- Osservazione di source sporca e ignored, target in uso o spostato. Le letture usano il profilo Git con scritture negate.
- Guard creato senza force. Il pin prova ad aprire il lock sulla ref durante checkout implicito. Il percorso qualificato prenota con `worktree add --no-checkout` e materializza il tree con `read-tree` dopo verifica di directory e indice iniziali. Hook ostile non eseguito.
- Fast-forward tramite CAS sulla sola ref target, poi verifica distinta di indice e file del guard. Fault prima del CAS conserva l'OID precedente, fault dopo CAS osserva il nuovo OID e rifiuta la sincronizzazione se il guard ha lavoro aggiunto.
- Un target divergente resta intatto nel caso di fast-forward. Il percorso a due parent è verificato nella ripresa US2.

## T035 — scenari del quickstart

| Scenario | Esito locale | Ambito della prova |
| --- | --- | --- |
| US1 | PASS per checkpoint, diff sigillato, criteri, check, replay, invalidazione del grant e archivio offline. | Checkpoint 009 di fixture, Git nativo, job 007 e registro locale in loopback. |
| US2 | PASS per fast-forward, merge divergente con due parent, conflitto, staging registrato, check 007, CAS e recovery. | Ref su repository temporanei posseduti dalla suite. |
| US3 | PASS per ricevuta, freshness Discovery, documenti, prova cleanup e rifiuto della rimozione quando compare un nuovo commit. | Approvazione Discovery e integrazione pregresse di fixture. Chiusura CLI/Desktop attraverso il daemon. |

La build standard compone il percorso Git con ownership 006 e check 007. L'avvio di uno snapshot dipende da un checkpoint 009 corrente e quiescente. Lo storico è leggibile anche a daemon fermo. Per il collegamento automatico al check 007, un criterio 005 usa `command:<UUID CommandSpec>` nel campo `verification`. Le descrizioni libere restano visibili con esito NOT_RUN.

Limiti verificati sul diff di 100 file e 2 MiB, chunk di lettura fino a 8 KiB e una reservation attiva per repository durante l'integrazione. Candidate/preflight e singoli check usano i budget del piano. La verifica locale non fornisce una misura generale di latenza. Qualifica del reviewer assistito, login, hosting, review umana e campagna su repository operativi sono NOT_RUN.

## Ripresa US1

I controlli 007 sul tree sorgente hanno superato la prova con job host macOS e registry di fixture su loopback. Il diff può essere letto con il target in uso, conservando HEAD e contenuto del checkout esterno. La prenotazione Git per l'integrazione continua a richiedere il target libero. Grant `execution.start` distinto per il feedback, provato con host 009 di fixture. L'host di produzione per correzioni resta subordinato alla qualifica 009.

## Ripresa US2

Sul pin Git Apple già qualificato, il candidate divergente usa `merge-tree` e `commit-tree` in staging. Il sandbox di staging circoscrive le scritture al worktree posseduto, al suo amministrativo e agli oggetti Git. Il tentativo con il comando completo `git merge` richiedeva `packed-refs.lock` ed era bloccato. Il CAS resta limitato alla ref target e al relativo reflog. Il test locale esercita 006, 007 e il recovery senza replica del CAS.
