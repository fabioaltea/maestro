# Validazione 011

## T001 — baseline

Base `0f9a9be`, schema 10. La 010 ha concluso 20/36 task e verificato 24 test core, 58 Desktop unit/contract e 1 E2E. La coda conserva reservation incerte e usa fixture per il dispatch. 009 fornisce checkpoint portabili e stato di quiescenza di fixture. Il commit core 009 e il runtime di produzione restano aperti.

001/T082 NOT_RUN, 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 PROVIDER_UNSAFE e 005 G1 BLOCKED. La qualifica G1 di 009 e le review umane restano pendenti. La 011 usa il pin Git esistente e checkout temporanei posseduti dalla suite. Scope locale, nessuna campagna di volume o durata.

## Ripresa T011

`npm run build:test`, `npm run lint` e 4 test di integrazione in `review-store.test` e `review-us1.test` PASS. Le conferme di snapshot e feedback usano grant del daemon corrente. Un retry concorrente con gli stessi identificativi condivide l'operazione in corso. Il drain impedisce di confermare dopo la chiusura dell'ammissione. Il rigetto conserva il grant e la query dei risultati precedenti rimane disponibile. Il recovery marca come interrotto un intento di snapshot pendente e preserva l'esito terminale a un ulteriore riavvio simulato. La riconciliazione del cambio ref è coperta dal task T024.

## Ripresa T012

Tre test core mirati (`review-limits.test`, `review-us1.test`), due contratti Desktop e typecheck Desktop PASS. Il commit dello snapshot emette `review.changed` e, se il diff ha parti sigillate, `review.output.available` con il numero delle parti. Il journal e Desktop ricevono solo metadati. A outbox saturo la conferma del feedback lascia intatti grant e ledger, con query dello snapshot precedente disponibile. Alla quota ordinaria il nuovo grant è rifiutato, mentre il discard del feedback ancora senza riferimenti e il recovery dello snapshot usano la riserva terminale.

## Ripresa T013

Sette test unitari e di contratto mirati PASS. Il checkpoint rifiuta modifiche staged/unstaged e file untracked, patch fuori schema e incoerenze di tree, digest e piano. Una prova 007 con comando o input discordante, output incompleto, exit non verificata o tree superato resta BLOCKED. Un criterio con prove discordanti resta bloccato anche quando una prova risulta PASS.

## Ripresa T015

La fixture US1 esegue Git e il job host 007 sul worktree posseduto. Prima dell'avvio e dopo l'uscita, il job verifica l'impronta del checkpoint. I criteri provengono dalla revisione 005 sigillata e l'esito riporta job, comando, tree e output. Un edit dopo la preparazione invalida la conferma. I fault prima e dopo il commit dello snapshot verificano rispettivamente il rilascio delle parti senza riferimenti e il recupero dello snapshot con UUID originale. Un fault dopo l'ammissione di una validazione, prima del job, lascia la richiesta interrogabile e il riavvio la chiude con CHECKS_NOT_RUN. Retry concorrenti conservano lo stesso esito. Il feedback arriva al solo host 009 di fixture dopo un nuovo grant di esecuzione.

Build core e test, typecheck Desktop, lint e nove prove mirate 011/007 PASS. Cinque ulteriori prove mirate 011/009 PASS dopo il collegamento del feedback.

## T034 — verifica locale

- Build, build test, typecheck core e Desktop, build Electron e lint architetturale PASS.
- Suite core mirata, 27 PASS, 0 FAIL, 0 SKIP. Include cinque prove native G0, la migrazione 10→11 e regressioni schema 9→10 e lease workspace. Il successivo test unitario su chiusura/cleanup porta il totale a 28 PASS mirati.
- Desktop unit/contract, 60 PASS, 0 FAIL, 0 SKIP. E2E Electron review e coda, 2 PASS, 0 FAIL, 0 SKIP.
- FR-001–003. Una fixture 009 con exit proof e checkpoint Git pulito produce un diff sigillato, ricostruibile da CLI e Desktop. Un edit tardivo invalida il grant. La perdita dell'artefatto feedback lascia il grant intatto. Il confronto dei risultati richiesti è legato al tree. La validazione end-to-end 007 sul candidate resta aperta.
- FR-004–006. G0 nativo verifica guard, fast-forward CAS, sync e fault pre/post CAS. Il port rifiuta target occupato, modificato o divergente. Staging, candidate a due parent, validazione e grant d'integrazione non sono pubblicati.
- FR-007–009. Gli invarianti di dominio richiedono prova attribuita del CAS, guard sincronizzato e prova cleanup corrente. Un commit nuovo o un file non integrato bloccano il preview. Receipt, ricalcolo Discovery e cleanup delegato end-to-end restano aperti.
- FR-010–012. DTO chiusi, metadati paginati, chunk fino a 8 KiB, outbox atomica redatta, storico immutabile offline, limiti sui diff e rollback su quota. Il bridge Desktop di review espone consultazione.

Nessuna misura generale di latenza. Acceptance e benchmark Foundation di volume o durata non sono stati rilanciati.
