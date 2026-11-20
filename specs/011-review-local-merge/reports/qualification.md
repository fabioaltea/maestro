# Qualifica 011

## T004 — G0 del 20 novembre 2026

**5 PASS** su macOS arm64/APFS. Git `2.50.1 (Apple Git-155)`, SHA-256 `492bd04fb367c1d51dce2be4eb6d6778829a3623dc4327318dfcdd81bc4fac2e`, profilo base `43d018cd1163f6593ed8c9e8fca25a529a1912e9e5b1aa01e2ea1593eee3efe1`. La suite usa repository temporanei, Git confinato e sole ref di fixture.

- Osservazione di source sporca e ignored, target in uso o spostato. Le letture usano il profilo Git con scritture negate.
- Guard creato senza force. Il pin prova ad aprire il lock sulla ref durante checkout implicito. Il percorso qualificato prenota con `worktree add --no-checkout` e materializza il tree con `read-tree` dopo verifica di directory e indice iniziali. Hook ostile non eseguito.
- Fast-forward tramite CAS sulla sola ref target, poi verifica distinta di indice e file del guard. Fault prima del CAS conserva l'OID precedente, fault dopo CAS osserva il nuovo OID e rifiuta la sincronizzazione se il guard ha lavoro aggiunto.
- Un target divergente resta intatto. Candidate a due parent, staging registrato nello store, validazioni 007 sul candidate e l'uso del port in un'integrazione reale restano da qualificare.
