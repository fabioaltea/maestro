# Research: Storico Git ed esploratore di `main`

## Confine di lettura

- **Decisione**: Estendere il comando locale di ispezione usato dai documenti repository (`src/core/inspect-main.ts`, `apps/desktop/src/main/read-handlers.ts`). Riusare verifica delle ancore e runner del Core con argomenti tipizzati, ambiente pulito, deadline e sandbox senza rete.
- **Motivo**: Mantiene l'accesso confinato e funziona anche con daemon fermo se il registro locale è leggibile.
- **Alternative scartate**: Git nel renderer/main Electron; nuovo percorso RPC in streaming nel daemon. Il primo rompe il confine del Core, il secondo amplia una superficie non necessaria.

## Storico stabile e consultazione dei worktree

- **Decisione**: Acquisire in un'unica osservazione i riferimenti locali e l'inventario worktree, includere gli HEAD scollegati tra le radici della cronologia e usare OID fissati per tutte le pagine. Validare l'osservazione prima di pubblicarla; se le radici cambiano durante l'acquisizione, restituire uno stato di retry.
- **Motivo**: Paginare direttamente su riferimenti mobili può saltare o duplicare commit. L'inventario Git mostra anche worktree esterni a Maestro; non serve ispezionarne i file.
- **Alternativa scartata**: Il solo registro dei workspace Maestro omette worktree esterni e HEAD scollegati.

## File e lettore

- **Decisione**: Risolvere `refs/heads/main` una volta per apertura/refresh. Sfogliare gli alberi dal commit fissato e leggere soltanto blob normali raggiunti dall'albero; verificare tipo e dimensione prima del contenuto. Usare i parser Lezer per TS/JS, JSON, CSS, HTML e Markdown; il lettore React aggiunge numeri di riga e ricerca, con testo semplice per gli altri formati.
- **Motivo**: Evita di leggere il checkout per errore. I parser riusati da CodeMirror permettono di evidenziare il testo con classi statiche, senza rilassare la Content Security Policy.
- **Alternative scartate**: Monaco/integrazione VS Code per una vista di sola consultazione; viewer HTML con tokenizer scritto ad hoc.
