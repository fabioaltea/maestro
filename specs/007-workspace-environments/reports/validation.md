# Validazione 007

## T001 — baseline e dipendenze

19 novembre 2026, branch cumulativo `007-workspace-environments-implementation` da `c536337`. Schema 6 e primitive Workspace della 006 disponibili. La baseline mirata 006 ha 50 PASS core, 48 unit/contract desktop, 13 integrazioni desktop e 1 E2E. Node 26.13.0, npm 11.20.0, macOS 26.3.1 (a) arm64/APFS. Prerequisiti Spec Kit presenti e checklist requisiti 16/16. [Validazione 006](../../006-git-workspaces/reports/validation.md)

La prima qualifica usa pnpm installato localmente e un registro HTTP su loopback con pacchetti sintetici. Le prove non usano account, login, registry esterni o progetti utente. Schema 7 sarà accessibile soltanto dopo upgrade esplicito. Il profilo del processo e la release proof della lease derivano da evidenze di questa feature.

Restano aperti 001/T082 NOT_RUN e 001/T085 FAIL/OPEN, 002/T093 BLOCKED, 003/T054 REVIEW_PENDING, 004/T028 e T050 BLOCKED da PROVIDER_UNSAFE e G1 reale 005 BLOCKED. La review 006 ha lasciato invariati questi gate. Nessuna ripetizione automatica del flake UPDATE replay 61 vs 60. [Readiness 006](../../006-git-workspaces/reports/release-readiness.md)

## T003 — primitiva pnpm macOS

Porta neutra e adapter con pin del binario Node e dell’intera distribuzione pnpm, due root private, politica SBPL su file/processi/rete, input frozen e output bounded. Il processo osservato è l’unico che il profilo può eseguire. Cancellazione tramite handle del figlio e attesa di chiusura. La fixture qualifica anche config ambientale ostile e redirect HTTP verso altro endpoint. Build, build:test, lint e **4 PASS** in integrazione.

## T005 — test iniziali

Tre RED prima di modello e namespace, con stato manuale/stale, generazioni, limiti e scope dei grant.

## T006 — test iniziali

Quattro RED prima dell’upgrade 6→7. Reader immutabile, putative fault pre/post commit e collisioni in entrambi i versi.

## T007 — schema cumulativo 7

Lo start esplicito migra 6→7 sotto le lease esistenti. Il rebuild del parent workflow conserva riferimenti e guard UUID, con integrity/FK verificati nella transazione. Lo schema 6 resta leggibile e immutabile. Discovery, Feature e Workspace operano anche su 7. Build e build:test PASS. **16 PASS** tra state, migrazione, collisioni e regressioni Workspace/Feature.

## T008 — reservation e artefatti

Piano prenotato nel ledger comune e pubblicato solo dopo verifica del file sigillato, dei digest e della revisione workspace. Quota condivisa, replay con UUID identico e file mancante verificati. Build:test e **6 PASS** tra store ambiente e workflow. Gli eventi del namespace sono completati da T012.

## T009 — superficie API e storico (RED)

Due RED prima di parser e reader. DTO chiusi, envelope bounded, prepare distinto dall’admission e interrogazione immutabile dell’UUID originale.

## T010 — protocollo e reader confinato

Superficie chiusa per piano, autorizzazione, admission e storico. Il reader limita pagine e chunk, verifica lo scope di cursori e artefatti e restituisce currentness UNKNOWN offline. Il client recupera soltanto l’UUID originale e condivide il trasporto Workspace. Build, build:test e **4 PASS** di contratti/offline Environment e Workspace.

## T011 — runtime e drain

Il daemon espone solo le letture Environment già composte su schema 7. Fencing prima della recovery e prima dello shutdown. I piani interrotti mantengono il UUID originale. I job accettati appartengono al daemon e il drain è bounded. Gli import dei servizi restano nelle porte. Build, build:test, lint e **7 PASS** delle integrazioni runtime Environment, Feature e Workspace.

## T012 — metadata e quote

Il writer include gli eventi Environment nell’outbox atomica. Core e desktop accettano soltanto identità, stato e watermark. Dati privati e testo rimangono fuori dagli eventi. Il backlog bloccato preserva l’UUID accettato e rifiuta nuove ammissioni. Build:test, typecheck desktop, lint e **4 PASS** mirati di limiti, store e runtime.

## T013 — prove US1

Due RED per lock concorrenti, pin, hook, fonti esterne e attestation stale.

## T014 — prove US1

1 PASS su capability, confine di ruolo e attestation chiusa.

## T015 — prove US1

Due RED per piano da input statici, replay e attestation stale su worktree reale di fixture.

## T016 — piano statico e fence d’attestazione

Il dominio riconosce il pin e il formato lock, distingue piano qualificabile e MANUAL_REQUIRED e conserva solo i nomi degli script. Regole esplicite per config eseguibile, fonti non dichiarate e digest, generazione e revisione dell’attestazione. Build:test e **2 PASS** mirati.

## T017 — piano e attestazione

Lettura bounded di dati statici su worktree con proprietà verificata. Il pin viene verificato dai file e la pianificazione non lancia pnpm. Il consenso attesta solo input e revisione correnti. Test pnpm PLANNED, npm manuale e replay attestazione PASS. Build, build:test e lint PASS.

## T018 — CLI US1

La CLI usa la revisione e l’UUID originali. Le limitazioni di attestazione viaggiano da file o stdin. **6 PASS** delle prove mirate US1.

## T019 — desktop US1

Dalla vista Workspace si apre il piano d’ambiente. Conferma e ricevuta con digest, tastiera/focus, attestazione manuale, storico offline e cambio archivio verificati. Typecheck, build, **49 PASS** unit/contract e **1 PASS** E2E (29,2 s).

## T020 — policy install (RED)

Due RED per piano manuale, mismatch, input stale, exit verificato e generazione errata.
