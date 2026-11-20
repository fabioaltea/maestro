# Implementation Plan: Un repository alla volta in Maestro

**Branch** `013-repository-first-desktop` · **Data** 2026-11-20 · [Specifica](spec.md)

## Summary

Desktop apre il registro privato predefinito del core in sola consultazione. Una scelta esplicita di repository può avviare il servizio e registra o ritrova il progetto. Le viste successive lavorano sul progetto attivo. La creazione inizializza Git mediante un effetto supervisionato e poi usa lo stesso registro. Discovery e Feature Planning mantengono le rispettive autorizzazioni.

## Technical Context

- **Language/Version** TypeScript strict, Node 26.13.0, Electron 45.3.0, React 19.3.1.
- **Primary Dependencies** Pin esistenti di Git Apple, SQLite, esbuild e Playwright. Nessun pacchetto nuovo.
- **Storage** Schema 11, stesso writer, registro e ricevute esistenti. Il recupero iniziale riferisce un archivio verificato nella sua directory originale.
- **Testing** Suite mirate Node e Playwright con archivio temporaneo, Git nativo confinato e provider di fixture.
- **Target Platform** macOS 26.3 arm64/APFS.
- **Project Type** Core headless, CLI e Desktop.
- **Performance Goals** Dieci riaperture mirate con soglia 2 s per nove casi. Misure separate dal bootstrap a freddo e da Discovery.
- **Constraints** Directory dati privata, apertura locale, consenso separato per il provider, esiti durevoli, zero modifiche implicite al checkout esistente.
- **Scale/Scope** Un progetto attivo per finestra e più progetti nell’archivio. Recupero singolo, senza fusione.

## Constitution Check

| Principio | Prima e dopo il design |
| --- | --- |
| I | PASS design. Il core individua lo stato locale e le letture funzionano a servizio fermo. |
| II | PASS design. CLI/Desktop condividono comando e ledger del core. La chiusura del client lascia proseguire lavoro ammesso. |
| III | PASS design. Discovery riusa capability reali e provider di fixture nei test. |
| IV | PASS design. L’apertura riusa ispezione confinata. Init limita le scritture ai metadati di un nuovo repository e richiede una destinazione esplicita. |
| V | PASS design. Identità stabile prima dell’effetto, stesso UUID per query, osservazione senza reinizializzare dopo esito incerto. |
| VI | PASS design. Apri/Crea autorizzano soltanto richiesta locale. Consenso fonti e approvazione del contesto restano nel core. |
| VII | PASS design. Port sostituibili, test unitari, contratti, Git locale, E2E e tastiera. |
| VIII | PASS design. Registro, correlazione e log strutturati redatti. |

## Project Structure

```text
src/{cli,client,core/projects,domain/projects,protocol,ports}/
src/platform/macos/{paths.ts,git/}
apps/desktop/src/{main,shared,preload,renderer}/
tests/{contract,integration}/
apps/desktop/tests/{contract,e2e}/
specs/013-repository-first-desktop/{spec,plan,research,data-model,quickstart,tasks}.md
specs/013-repository-first-desktop/{contracts,reports}/
```

Il servizio del registro esegue la creazione attraverso il supervisore Git. Desktop usa la CLI esistente e mantiene la selezione distinta dallo store. Il recupero del percorso locale appartiene al core.

## Phases

1. Ricerca del confine di avvio, creazione confinata, selezione del progetto e recupero in situ.
2. Contratti headless/Desktop, transizioni, dati e quickstart.
3. Task per ingresso repository, Discovery → feature, recenti e recupero, con controlli finali separati.

## Complexity Tracking

La posizione di un archivio fa parte della sua identità. Il recupero registra il riferimento verificato alla posizione originale e preserva la continuità di store, ricevute e worktree. La build mantiene i gate 001–011 e la qualificazione reale separata.
