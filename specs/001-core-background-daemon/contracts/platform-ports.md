# Platform ports — AR-001 e AR-002

Contratti progettuali, non codice da compilare. Implementazione iniziale solo macOS 26.3 arm64.
Il dominio non importa primitive OS; il composition root sceglie esplicitamente l'adapter.
OS/architettura non supportati ⇒ UNSUPPORTED_PLATFORM prima di mutare stato.

| Porta | Operazioni e risultati | Invariante |
|-------|------------------------|------------|
| DaemonLauncher | spawnController(intent), spawnDaemon(instanceIntent) → observed child handle/identity | Detached, niente shell, stdio indipendenti dal terminale; spawn non significa ready |
| OwnershipLease | tryAcquire(scope) → HELD(handle) / BUSY / UNKNOWN; release alla fine del ruolo | Un titolare per file; niente TTL, unlink o sottrazione; chiusura prematura proibita |
| ProcessIdentity | challenge(endpoint, generation), observeExit(handle), probeAbsent(pid) | VERIFIED / ABSENT / UNKNOWN; PID positivo mai prova di appartenenza |
| LocalTransport | listen(privateEndpoint), connect(descriptor), authenticate(capability), close | UDS privato, nessun TCP; versione/token verificati prima del dispatch |
| PlatformPaths | resolveArchive, privateRuntimeDir, validateOwnerAndLinks, ownedCleanup | Percorsi canonici, UID reale, permessi; cleanup solo artefatti propri identificati |
| Clock | wallUtc, monotonicNow, deadline | Ordine seq separato da ora civile; test senza attese reali |
| StoragePort | readSnapshot, acceptOperation, transition, reconcile, appendOutbox, drainEvents | Transazioni idempotenti, nessun accesso SQL da CLI o dominio |

## Lease SQLite

Due database separati dallo stato, una connessione ciascuno nel processo proprietario.
`BEGIN IMMEDIATE` resta aperto senza scritture applicative; nessun commit/rollback finché
il ruolo è proprietario. Prima creazione concorrente gestisce BUSY come contesa normale.
Nessuna altra connessione al medesimo inode nel processo che detiene il lease; niente
letture raw o routine generiche che possano chiudere descrittori del lease.
Il daemon non rilascia intenzionalmente prima di uscire; controller rilascia solo dopo
finalizzazione o blocco registrato e prima di terminare.

L'acquisizione non è prova di morte: il chiamante verifica anche l'identità precedente.
Su errore del lease, la proprietà è UNKNOWN; arrestare nuove mutazioni. Database lease
inaccessibile/corrotto non viene ricreato. Le connessioni di probe in altri processi sono
brevi, non mantengono reader e non eliminano il file.

## Identità senza native addon aggiuntivo

Credenziale casuale e generation su handshake per processi posseduti; exit osservato
tramite child handle quando disponibile; sonda di sola esistenza per assenza.
Nessun parsing del nome di processo e nessun segnale da PID recuperato. Un PID riutilizzato
ma vivo può bloccare l'avvio finché non si chiarisce la situazione: è il comportamento
conservativo accettato da questa Foundation, da spiegare nella diagnostica.

Il futuro adapter può offrire ispezione libproc o un handle OS più forte. Il contratto
non deve trasformare automaticamente «identità osservata» in «segnalazione atomica sicura».

## Policy separata

`FoundationAuxiliaryRecovery` consuma le prove di ProcessIdentity e decide shutdown
cooperativo/attesa/BLOCKED. Non vive nell'adapter OS e non viene invocata su un processo
senza policyScope=foundation. Nessun framework plugin/policy o Agent Runtime costruito ora.

## Test del confine

- Sostituti deterministici per live/absent/unknown, PID reuse, clock jump, lease conteso.
- Verifica dei divieti d'import nel dominio e nel client.
- Integrazione reale: chiusura terminale, parent exit, due archivi, dieci launcher simultanei,
  worker crash senza rilascio della proprietà del daemon, lease file mai rimosso.
- Test di sicurezza: percorso symlink, socket/file di altro UID, capability errata,
  directory troppo lunga, stato readonly; nessuna mutazione in caso di errore.
