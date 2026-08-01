import { expect, test } from '@playwright/test';
import {
  identifyFile,
  sourcePath,
  type FileIdentity,
} from './fixtures/media';

test.describe('analysis generation failure', () => {
  test.skip(
    process.env.VIDSCRIBE_TEST_ANALYSIS_FAILURE !== '1',
    'Run with VIDSCRIBE_TEST_ANALYSIS_FAILURE=1 against the deterministic failure adapter.',
  );

  let originalSource: FileIdentity;

  test.beforeAll(() => {
    originalSource = identifyFile(sourcePath);
  });

  test('keeps partial Analysis Preview visible without promoting Final Review', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Select Source' }).click();
    await page.getByRole('button', { name: 'Select Destination' }).click();
    await page.getByLabel('Session Date').fill('2026-07-31');
    const sessionRequestPromise = page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/sessions',
    );
    await page.getByRole('button', { name: 'Execute' }).click();
    const intake = (await sessionRequestPromise).postDataJSON() as Record<string, unknown>;
    expect(intake.source_selection_id).toEqual(expect.any(String));
    expect(intake.destination_selection_id).toEqual(expect.any(String));

    const preview = page.getByRole('region', { name: 'Analysis Preview' });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/analysis|generation/i);
    await expect(page.getByRole('region', { name: 'Final Review' })).toHaveCount(0);

    const partialPreview = (await preview.textContent())?.trim();
    expect(partialPreview, 'the provider stream remains visible after failure').toBeTruthy();
    expect(identifyFile(sourcePath)).toEqual(originalSource);
  });
});
