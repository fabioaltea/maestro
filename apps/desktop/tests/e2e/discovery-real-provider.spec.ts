import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch, repositoryRoot } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
const optedIn = process.env.MAESTRO_DISCOVERY_REAL === '1' && process.env.MAESTRO_DISCOVERY_REAL_CONSENT === 'synthetic-scratch-readonly';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('G1 SC-001 official Codex login: UI interview, correction, exact approval and headless observation', async () => {
  test.skip(!optedIn, 'NOT_RUN: explicit real-provider consent absent');
  test.setTimeout(1_800_000);
  const binary = process.env.MAESTRO_DISCOVERY_REAL_BINARY, model = process.env.MAESTRO_DISCOVERY_REAL_MODEL;
  test.skip(!binary || !model, 'NOT_RUN: exact qualified native binary/model absent');
  const f = await createScratch();
  try {
    await f.cli(['daemon', 'start']); const repo = await f.repository('real-provider-synthetic');
    await writeFile(join(repo.path, 'README.md'), '# Synthetic delivery tracker\nA local TypeScript tool records delivery items in SQLite. Run with node.\nDeployment target and intended audience are intentionally absent. The owner must clarify these before a useful project document is drafted. No credentials or real customer data exist in this repository.\n');
    await repo.git(['add', 'README.md']); await repo.git(['commit', '-m', 'synthetic context']);
    const projectId = (await f.cli(['project', 'add', repo.path, '--name=SC001 sintetico'])).result.data.projectId;
    const before = await f.snapshot(repo.path), { app, page } = await launchDesktop(f);
    try {
      await page.getByRole('button', { name: 'Diagnostica', exact: true }).click();
      await page.getByText('Configurazione avanzata di Codex', { exact: true }).click(); await chooseDirectory(app, binary!); await page.getByRole('button', { name: 'Scegli binario Codex', exact: true }).click(); await page.getByLabel('Modello Codex', { exact: true }).fill(model!);
      await page.getByRole('button', { name: 'Configura provider', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click(); await expect(page.locator('details.discovery-provider')).toContainText(model!, { timeout: 15000 });
      await page.getByRole('button', { name: 'Verifica provider e login', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect.poll(async () => Boolean((await f.cli(['discovery', 'provider', 'get'])).result.data.check), { timeout: 15000 }).toBe(true);
      const provider = (await f.cli(['discovery', 'provider', 'get'])).result.data;
      await writeFile(join(repositoryRoot, 'specs/004-project-discovery/reports/real-provider-status.json'), JSON.stringify({ schemaVersion: 1, phase: 'LOGIN_PRECHECK', checkedAt: new Date().toISOString(), modelId: model, configuredBinaryVersion: provider.configuration?.binaryVersion, configuredBinarySha256: provider.configuration?.binarySha256, availability: provider.check?.state ?? 'UNKNOWN', code: provider.check?.code ?? null, inferenceStarted: false, fixtureRepositoryUnchanged: JSON.stringify(await f.snapshot(repo.path)) === JSON.stringify(before) }, null, 2) + '\n');
      test.skip(['PROVIDER_AUTH_REQUIRED', 'PROVIDER_UNAVAILABLE'].includes(provider.check?.code), `NOT_RUN: official login unavailable (${provider.check?.code ?? 'UNKNOWN'})`);
      expect(provider.check?.state, `BLOCKED: qualified official login check rejected (${provider.check?.code ?? 'UNKNOWN'})`).toBe('AVAILABLE');
      await page.getByRole('button', { name: 'Repository', exact: true }).click();
      await page.locator('.project-row').first().click();
      await page.getByRole('button', { name: 'Analizza codebase', exact: true }).click();
      await page.getByLabel('Percorsi da analizzare', { exact: true }).fill('README.md'); await page.getByRole('button', { name: 'Prepara anteprima', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Anteprima dei contenuti', exact: true })).toBeVisible({ timeout: 15000 });
      await writeFile(join(repositoryRoot, 'specs/004-project-discovery/reports/real-provider-status.json'), JSON.stringify({ schemaVersion: 1, phase: 'INFERENCE_AUTHORIZED', checkedAt: new Date().toISOString(), modelId: model, availability: provider.check.state, inferenceStarted: null }) + '\n');
      await page.locator('.discovery-consent input').check(); await page.getByRole('button', { name: 'Avvia Discovery', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      const list = () => f.cli(['discovery', 'list', projectId]); await expect.poll(async () => (await list()).result.data.items?.length, { timeout: 15000 }).toBe(1);
      const discoveryId = (await list()).result.data.items[0].discoveryId;
      await expect.poll(async () => (await f.cli(['discovery', 'show', discoveryId])).result.data.discovery.state, { timeout: 610000, intervals: [1000] }).toBe('WAITING_USER');
      await page.getByRole('button', { name: 'Aggiorna Discovery', exact: true }).click(); const answer = page.locator('.discovery-question textarea').first(); await expect(answer).toBeVisible({ timeout: 15000 }); await answer.fill('Utenti: sviluppatori locali. Distribuzione esclusivamente sul proprio Mac, senza server remoto.'); await page.locator('.discovery-question').first().getByRole('button', { name: 'Invia e continua', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect.poll(async () => (await f.cli(['discovery', 'show', discoveryId])).result.data.discovery.state, { timeout: 610000, intervals: [1000] }).toBe('READY_FOR_REVIEW');
      await page.getByLabel('Correzione alla revisione', { exact: true }).fill('Rendi espliciti tutti i limiti e le ipotesi senza inventare evidenze.'); await page.getByRole('button', { name: 'Invia correzione', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect.poll(async () => (await f.cli(['discovery', 'revisions', discoveryId])).result.data.items?.length, { timeout: 610000, intervals: [1000] }).toBe(2);
      const review = page.locator('.discovery-review'); await expect(page.getByRole('button', { name: 'Approva questa revisione', exact: true })).toBeVisible({ timeout: 15000 }); for (const box of await review.getByRole('checkbox').all()) await box.check();
      await page.getByRole('button', { name: 'Approva questa revisione', exact: true }).click(); await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click(); await expect(review).toContainText('Approvazione storica:', { timeout: 15000 });
      const d = (await f.cli(['discovery', 'show', discoveryId])).result.data.discovery; expect(d.state).toBe('APPROVED'); const document = (await f.cli(['discovery', 'document', d.latestDocumentRevisionId, '--metadata'])).result.data; expect(document.approval.revisionId).toBe(d.latestDocumentRevisionId); expect(document.revision.provenanceValidated).toBe(true);
      expect(await f.snapshot(repo.path)).toEqual(before);
      await writeFile(join(repositoryRoot, 'specs/004-project-discovery/reports/real-provider-status.json'), JSON.stringify({ schemaVersion: 1, phase: 'COMPLETED', checkedAt: new Date().toISOString(), modelId: model, inferenceStarted: true, fixtureRepositoryUnchanged: true, discoveryId, revisionId: d.latestDocumentRevisionId, bundleDigest: document.revision.bundleDigest, outcome: 'PASS' }, null, 2) + '\n');
    } finally { await app.close(); }
  } finally { await f.cleanup(); }
});
