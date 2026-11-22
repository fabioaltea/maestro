import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratch } from '../fixtures/desktop.ts';
import { chooseDirectory, launchDesktop } from '../fixtures/electron.ts';

test('consults a merge and a detached worktree from Repository History', async () => {
  test.setTimeout(60_000);
  const fixture = await createScratch();
  try {
    const repo = await fixture.repository('Repository storico');
    const main = (await repo.git(['branch', '--show-current'])).stdout.trim();
    await repo.git(['switch', '-c', 'history-topic']);
    await writeFile(join(repo.path, 'topic.txt'), 'topic\n');
    await repo.git(['add', '--', 'topic.txt']);
    await repo.git(['commit', '-m', 'Topic commit']);
    await repo.git(['switch', main]);
    await repo.git(['merge', '--no-ff', '-m', 'Merge topic', 'history-topic']);
    await repo.git(['worktree', 'add', '--detach', join(repo.path, '..', 'detached-history'), 'HEAD^']);
    const { app, page } = await launchDesktop(fixture);
    try {
      await chooseDirectory(app, repo.path);
      await page.getByRole('button', { name: 'Apri repository', exact: true }).click();
      await page.getByRole('button', { name: 'Storico Git', exact: true }).click();
      const history = page.getByRole('region', { name: 'Storico Git' });
      await history.getByRole('button', { name: /Merge topic/ }).click();
      await expect(history.getByText('topic.txt', { exact: true })).toBeVisible();
      const worktree = history.getByRole('button', { name: /detached-history/ });
      await worktree.click();
      await expect(worktree).toHaveAttribute('aria-pressed', 'true');
      await expect(history.getByText(/Commit selezionato/)).toBeVisible();
    } finally { await app.close(); }
  } finally { await fixture.cleanup(); }
});
