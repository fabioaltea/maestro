# Policy — Feature Planning

## Contenuto e riferimenti

FeatureBundle v1 contiene request/title, specification (scope, users, stories, exclusions), implementationPlan (approach, dependencies, risks), acceptanceCriteria e provenance. Criterio: criterionId stabile, testo non vuoto, verifica descritta, required boolean. Massimo50criteri; ogni storia ha almeno un criterio, ogni requisito dichiarato almeno una verifica o spiegazione esplicita. Unknown: unknownId, testo, impatto, decisione OPEN/ACCEPTED; tutti gli unknown che bloccano scope/safety devono essere risolti prima dell’approvazione, gli altri accettati esplicitamente.

FeaturePlanningResult v1 è uno schema chiuso con kind QUESTIONS/DRAFT, domande ≤20 con questionId, testo e motivazione, bundle solo nel caso DRAFT, claim con sourceRef oppure USER_CONFIRMED/HYPOTHESIS/UNKNOWN. Il core controlla struttura, membership e digest delle fonti; non certifica la verità semantica del modello. Risultato nullo/unknown schema non può diventare revisione approvabile. Manuale e assistito producono lo stesso bundle.

## Eligibility e approvazione

`eligible = activeProject AND currentDiscoveryApproval AND validSealedBundle AND noBlockingUnknowns AND currentFeatureRevision`.

La verifica Discovery è una nuova osservazione core: checkId004 o true nel renderer non sono prove riutilizzabili. Prima della creazione acquisire configRevision, Discovery revision/approval/context e source observation; admission CAS sulla parte DB, poi controllo anchor/digest prima della pubblicazione della revisione. Se cambia nel frattempo conservare bozza come NEEDS_REVIEW e non emettere un handoff idoneo. Nessuna atomicità filesystem+SQLite promessa.

Approval tuple: store/project/configRevision, feature/revision/bundleDigest, Discovery revision/approval/contextDigest, acceptedUnknownIds ordinati e owner. Handoff è un artefatto di riferimento immutabile, riemesso solo su prova corrente; non vale come start grant009. Un piano approvato può essere letto storicamente anche quando eligibility=false.

## Runtime assistito

Generazione usa un port readonly nuovo e schema distinto, massimo un turno per feature e budget runtime condiviso conservativo con004; prima010 un solo processo agente complessivo004/005/009 può essere ammesso mediante lock Agent Runtime comune, senza liberare lo slot Discovery. Il ramo manuale non richiede G0 provider; G0/G1 assistito falliti disabilitano solo generate/answer. Il gate Discovery di creazione rimane obbligatorio anche nel ramo manuale.

Ogni turno registra consenso/input, generation e runtime identity prima di GO. Una risposta a domanda avvia un nuovo turno esplicito, non una ripresa invisibile. Risposta tardiva di revisione/generation precedente è storica senza cambiare currentRevision. Perdita owner, cancel e deadline usano il confine host004 riqualificato per il nuovo result schema; nessuna policy write.

## Copertura obbligatoria

T013–T019 proteggono create/revise/archive e offline; T020–T026 proteggono approve/handoff, unknown e freshness; T027–T033 proteggono generate/answer/cancel e schema/provider. Tutti i digest/revisioni si risolvono dal core. La qualifica reale della004 rimane BLOCKED finché la sua prova non passa: nessun dato di test entra nell’archivio di produzione come Discovery approvata.
