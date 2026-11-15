import { test, expect } from '@playwright/test';
import { createScratch } from '../fixtures/desktop.ts';
import { launchDesktop, chooseDirectory } from '../fixtures/electron.ts';
test('service controls require a visible confirmation and expose original operation outcomes', async () => {
  const f = await createScratch();
  try {
    const { app, page } = await launchDesktop(f);
    try {
      await chooseDirectory(app, f.archive); await page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
      await page.getByRole('button', { name: 'Servizio', exact: true }).click();
      await page.getByRole('button', { name: 'Avvia servizio', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
      await page.getByRole('button', { name: 'Annulla', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.getByRole('button', { name: 'Avvia servizio', exact: true }).click();
      await page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
      await expect(page.getByText('Operazione completata', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Arresta servizio', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Operazioni', exact: true }).click();
      await expect(page.getByText('Avvio servizio', { exact: true })).toBeVisible();
      await expect(page.getByText('Completata', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Rimuovi ricevuta conclusa', exact: true })).toBeVisible();
    } finally { await app.close(); }
    expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('LIVE_VERIFIED');
  } finally { await f.cleanup(); }
});
test('ten start close reopen stop cycles preserve daemon independence and finish explicit stop within twelve seconds', async () => {
  test.setTimeout(240_000);
  const f = await createScratch();
  const stops: number[] = [];
  try {
    for (let cycle = 0; cycle < 10; cycle++) {
      let session = await launchDesktop(f);
      try {
        await chooseDirectory(session.app, f.archive);
        await session.page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
        await session.page.getByRole('button', { name: 'Servizio', exact: true }).click();
        await session.page.getByRole('button', { name: 'Avvia servizio', exact: true }).click();
        await session.page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
        await expect(session.page.getByText('Operazione completata', { exact: true })).toBeVisible({ timeout: 15_000 });
      } finally { await session.app.close(); }
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('LIVE_VERIFIED');
      session = await launchDesktop(f);
      try {
        await chooseDirectory(session.app, f.archive);
        await session.page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
        await session.page.getByRole('button', { name: 'Servizio', exact: true }).click();
        await session.page.getByRole('button', { name: 'Arresta servizio', exact: true }).click();
        const started = performance.now();
        await session.page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
        await expect(session.page.getByText('Operazione completata', { exact: true })).toBeVisible({ timeout: 12_000 });
        stops.push(performance.now() - started); expect(stops.at(-1)).toBeLessThanOrEqual(12_000);
      } finally { await session.app.close(); }
      expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('ABSENT_VERIFIED');
    }
    const { writeFile } = await import('node:fs/promises');
    await writeFile('specs/003-desktop-core-ui/reports/lifecycle-samples.json', JSON.stringify({ cycles: 10, daemonSurvivedUiClose: 10, stopMs: stops, maxStopMs: Math.max(...stops) }, null, 2) + '\n');
  } finally { await f.cleanup(); }
});
test('actual main SIGKILL after service acceptance leaves the daemon and original receipt recoverable', async () => {
  test.setTimeout(60_000);
  const { once } = await import('node:events');
  const f = await createScratch();
  try {
    const first = await launchDesktop(f);
    await chooseDirectory(first.app, f.archive); await first.page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
    await first.page.getByRole('button', { name: 'Servizio', exact: true }).click();
    await first.page.getByRole('button', { name: 'Avvia servizio', exact: true }).click();
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const path = join(f.userData, 'operation-receipts');
    await first.page.getByRole('button', { name: 'Conferma operazione', exact: true }).click();
    await expect.poll(async () => (await f.cli(['daemon', 'status'])).result.liveness, { timeout: 15_000 }).toBe('LIVE_VERIFIED');
    const records = await readdir(path); const name = records.find(name => name.endsWith('.json'))!;
    const original = JSON.parse(await readFile(join(path, name), 'utf8')) as { requestId: string };
    const process = first.app.process(); const exited = once(process, 'exit', { signal: AbortSignal.timeout(10_000) });
    process.kill('SIGKILL'); await exited;
    expect((await f.cli(['daemon', 'status'])).result.liveness).toBe('LIVE_VERIFIED');
    const next = await launchDesktop(f);
    try {
      await next.page.getByRole('button', { name: 'Operazioni', exact: true }).click();
      await expect(next.page.getByText(original.requestId, { exact: true })).toBeVisible();
      expect((await f.cli(['daemon', 'operation', original.requestId])).result.outcome).toBe('SUCCEEDED');
      expect((await readdir(path)).filter(name => name.endsWith('.json')).length).toBe(1);
    } finally { await next.app.close(); }
  } finally { await f.cleanup(); }
});
test('real reply lost while main is stopped and killed reconciles the original durable UUID', async () => {
  test.setTimeout(60_000);
  const f = await createScratch();
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const execute = promisify(execFile);
  const { once } = await import('node:events');
  const { readdir, readFile } = await import('node:fs/promises'); const { join } = await import('node:path');
  const first = await launchDesktop(f); let killed = false;
  try {
    await chooseDirectory(first.app, f.archive); await first.page.getByRole('button', { name: 'Scegli archivio', exact: true }).click();
    await expect(first.page.getByText('Servizio fermo', { exact: true })).toBeVisible();
    const prepared = await first.page.evaluate(async () => {
      const c = await window.maestro.context({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:0});
      return await window.maestro.prepareAction({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:c.selectionEpoch,action:'daemon.start',params:{}});
    });
    expect(prepared.error).toBeNull();
    const confirmationId = (prepared.result as {confirmationId:string}).confirmationId;
    await first.page.evaluate(({id,epoch}) => { void window.maestro.confirmAction({bridgeVersion:1,callId:crypto.randomUUID(),selectionEpoch:epoch,confirmationId:id}); }, {id:confirmationId,epoch:prepared.selectionEpoch});
    const child = first.app.process();
    await expect.poll(async () => {
      const { stdout } = await execute('/bin/ps', ['-ax', '-o', 'ppid=,command='], {maxBuffer:1024*1024});
      return stdout.split('\n').some(line => {
        const match = /^\s*(\d+)\s+(.*)$/.exec(line);
        return match?.[1] === String(child.pid) && match[2]!.includes('dist/cli/main.js daemon start') && match[2]!.includes(f.archive);
      });
    }, {timeout:5000,intervals:[10]}).toBe(true);
    child.kill('SIGSTOP');
    await expect.poll(async () => (await f.cli(['daemon','status'])).result.liveness, {timeout:15000}).toBe('LIVE_VERIFIED');
    const directory = join(f.userData,'operation-receipts'), files = await readdir(directory);
    const original = JSON.parse(await readFile(join(directory, files.find(n => n.endsWith('.json'))!), 'utf8')) as {requestId:string;phase:string};
    expect(original.phase).toBe('PREPARED');
    const exited = once(child,'exit',{signal:AbortSignal.timeout(10000)}); child.kill('SIGKILL'); await exited; killed = true;
    const reopened = await launchDesktop(f);
    try {
      await reopened.page.getByRole('button',{name:'Operazioni',exact:true}).click();
      await expect(reopened.page.getByText(original.requestId,{exact:true})).toBeVisible();
      await expect.poll(async () => JSON.parse(await readFile(join(directory,`${original.requestId}.json`),'utf8')).phase).toBe('TERMINAL');
      await reopened.page.getByRole('button',{name:'Aggiorna operazioni',exact:true}).click();
      await expect(reopened.page.getByText('Completata',{exact:true})).toBeVisible();
      expect((await readdir(directory)).filter(n=>n.endsWith('.json'))).toHaveLength(1);
      expect((await f.cli(['daemon','status'])).result.liveness).toBe('LIVE_VERIFIED');
    } finally {await reopened.app.close();}
  } finally {
    if (!killed) {first.app.process().kill('SIGCONT'); await first.app.close();}
    await f.cleanup();
  }
});
