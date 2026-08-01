import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  dataPath,
  destinationPath,
  identifyFile,
  inspectAnalysisAudio,
  sourcePath,
  type FileIdentity,
} from './fixtures/media';

function findAnalysisAudio(root: string): string | undefined {
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findAnalysisAudio(path);
      if (nested) return nested;
    } else if (entry.name.endsWith('.ogg')) {
      return path;
    }
  }
  return undefined;
}

test.describe('real recording tracer bullet', () => {
  let originalSource: FileIdentity;

  test.beforeAll(() => {
    originalSource = identifyFile(sourcePath);
  });

  test('distills a real recording into a durable streamed review', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const trace = {
        previewLengths: [] as number[],
        sawPreviewWithoutFinalReview: false,
        sawPreparingWithoutReview: false,
        sawTranscribingWithoutReview: false,
      };
      const observe = () => {
        const text = document.body.innerText;
        const finalReview = [...document.querySelectorAll<HTMLElement>('[role="region"]')].find(
          (element) => element.getAttribute('aria-label') === 'Final Review',
        );
        const preview = [...document.querySelectorAll<HTMLElement>('[role="region"]')].find(
          (element) => element.getAttribute('aria-label') === 'Analysis Preview',
        );
        if (/preparing/i.test(text) && !preview && !finalReview) trace.sawPreparingWithoutReview = true;
        if (/transcribing/i.test(text) && !preview && !finalReview) trace.sawTranscribingWithoutReview = true;
        if (preview && !finalReview) trace.sawPreviewWithoutFinalReview = true;
        if (preview) {
          const length = preview.innerText.trim().length;
          if (length > 0 && trace.previewLengths.at(-1) !== length) {
            trace.previewLengths.push(length);
          }
        }
      };
      new MutationObserver(observe).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      Object.assign(window, { __vidscribePreviewAcceptanceTrace: trace });
    });

    await expect(page.getByRole('heading', { name: 'Final Review' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Analysis Preview' })).toHaveCount(0);

    const sourcePickerRequestPromise = page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/pickers/source',
    );
    await page.getByRole('button', { name: 'Select Source' }).click();
    const sourcePickerRequest = await sourcePickerRequestPromise;
    expect(new URL(sourcePickerRequest.url()).origin).toBe('http://127.0.0.1:5173');
    await expect(page.getByText('source.wav', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Select Destination' }).click();
    await expect(page.getByText(destinationPath, { exact: false })).toBeVisible();
    await page.getByLabel('Session Date').fill('2026-07-31');

    const sessionRequestPromise = page.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/sessions',
    );
    await page.getByRole('button', { name: 'Execute' }).click();
    const sessionRequest = await sessionRequestPromise;
    const intake = sessionRequest.postDataJSON() as Record<string, unknown>;
    expect(intake.source_selection_id).toEqual(expect.any(String));
    expect(intake.destination_selection_id).toEqual(expect.any(String));
    expect(intake).not.toHaveProperty('source_path');
    expect(intake).not.toHaveProperty('destination_path');

    const finalReview = page.getByRole('region', { name: 'Final Review' });
    await expect(finalReview).toBeVisible({ timeout: 30_000 });
    await expect(finalReview).toContainText('Recall Brief');
    await expect(finalReview).toContainText('Before');
    await expect(finalReview).toContainText('(Silence 00:16)');
    await expect(finalReview).toContainText('After');
    await expect(finalReview).not.toContainText('session_record_markdown');
    await expect(page.getByRole('region', { name: 'Session Intake' })).toContainText(/stage:\s*review/i);

    const transitionTrace = await page.evaluate(
      () =>
        (
          window as unknown as Window & {
            __vidscribePreviewAcceptanceTrace: {
              previewLengths: number[];
              sawPreviewWithoutFinalReview: boolean;
              sawPreparingWithoutReview: boolean;
              sawTranscribingWithoutReview: boolean;
            };
          }
        ).__vidscribePreviewAcceptanceTrace,
    );
    expect(transitionTrace.sawPreparingWithoutReview).toBe(true);
    expect(transitionTrace.sawTranscribingWithoutReview).toBe(true);
    expect(transitionTrace.sawPreviewWithoutFinalReview).toBe(true);
    expect(transitionTrace.previewLengths.length).toBeGreaterThan(1);

    expect(identifyFile(sourcePath)).toEqual(originalSource);

    const analysisAudio = findAnalysisAudio(dataPath);
    expect(analysisAudio, 'a reusable Analysis Audio artifact was created').toBeTruthy();
    const probe = inspectAnalysisAudio(analysisAudio!);
    expect(probe).toMatchObject({ codec: 'opus', channels: 1 });
    expect(probe.container).toContain('ogg');
    expect(probe.bitrate).toBeGreaterThanOrEqual(20_000);
    expect(probe.bitrate).toBeLessThanOrEqual(32_000);

    await page.reload();

    await expect(page.getByText('source.wav', { exact: true })).toBeVisible();
    await expect(page.getByText(destinationPath, { exact: false })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Analysis Preview' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Final Review' })).toContainText('(Silence 00:16)');
    expect(identifyFile(sourcePath)).toEqual(originalSource);
  });
});
