import { test, expect } from '@playwright/test';

const EPUB = '/home/kian/Downloads/CrimePunishment-EPUB2.epub';

test.describe('Contextual Reader smoke', () => {
  test('import EPUB, paginate, TOC, settings, ask', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase('contextual-reader');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
      });
    });
    await page.reload();

    await expect(page.getByText('Contextual Reader')).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(EPUB);

    await expect(page.getByText(/Crime and Punishment/i).first()).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('button', { name: /Chapters/i })).toBeVisible();
    await expect(page.getByText(/% through book/)).toBeVisible();

    // Jump to a real chapter via TOC
    await page.getByRole('button', { name: /Chapters/i }).click();
    await expect(page.getByRole('heading', { name: 'Chapters' })).toBeVisible();
    await page.getByRole('button', { name: /Chapter One/i }).first().click();
    await expect(page.getByRole('heading', { name: /Chapter One/i })).toBeVisible();

    // Structured paragraphs on a long chapter
    const bodyParas = page.locator('.font-reading p');
    await expect(bodyParas.first()).toBeVisible();
    expect(await bodyParas.count()).toBeGreaterThan(2);

    // Pagination on long chapter
    await expect(page.getByText(/Page \d+\/\d+/)).toBeVisible();
    const pageLabel = await page.getByText(/Page \d+\/\d+/).textContent();
    expect(pageLabel).toMatch(/Page 1\/([2-9]|\d{2,})/); // more than 1 page

    const before = await bodyParas.first().textContent();
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByText(/Page 2\//)).toBeVisible();
    const after = await bodyParas.first().textContent();
    expect(after).not.toEqual(before);

    // Bookmark
    await page.getByRole('button', { name: /Bookmark page/i }).click();
    await page.getByRole('button', { name: /^Bookmarks$/i }).click();
    await expect(page.getByText(/Chapter One/i).first()).toBeVisible();
    await page.getByLabel('Close').click();

    // Settings: dark mode + cache
    await page.getByRole('button', { name: /^Settings$/i }).first().click();
    await expect(page.getByRole('heading', { name: /Reading settings/i })).toBeVisible();
    await page.getByRole('button', { name: /^Dark$/ }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: /^Off\b/ }).click();
    await page.getByRole('button', { name: /^Less\b/ }).click();
    await page.getByLabel('Close settings').click();

    // Ask about passage (model optional)
    await page.getByRole('button', { name: /^Ask$/i }).click();
    await page.getByPlaceholder(/Highlight text/i).fill(
      'On an exceptionally hot evening early in July a young man came out of the garret.',
    );
    await page.getByPlaceholder(/Why is he afraid/i).fill('Who is the young man?');
    await page.getByRole('button', { name: /^Ask$/i }).last().click();
    await expect(
      page.locator('p.font-reading').filter({ hasText: /Model not enabled|WebLLM|Enable/i }),
    ).toBeVisible({ timeout: 10000 });
  });
});
