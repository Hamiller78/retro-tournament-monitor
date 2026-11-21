import { test, expect } from '@playwright/test';

test('a first elimination stage starts with all registered participants', async ({ page, request }) => {
  const name = `First elimination ${Date.now()}`;
  const created = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${created.id}`, headers = { Authorization: `Bearer ${created.token}` };
  for (const displayName of ['Alice', 'Bob', 'Cara']) await request.post(`${root}/participants`, { headers, data: { displayName } });
  const stage = (await (await request.post(`${root}/stages`, { headers, data: { name: 'Survival', kind: 'elimination', participantCount: 3 } })).json()).id;
  await request.put(`${root}/stages/${stage}/settings`, { headers, data: { game: 'Survival game', gameSelection: 'fixed' } });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('navigation', { name: 'Tournament views' }).getByRole('button', { name: 'Survival', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose game' })).toHaveCount(0);
  await expect(page.getByText('Survival game', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminate Cara' }).click();
  await page.getByRole('button', { name: 'Eliminate Bob' }).click();
  await expect(page.getByRole('dialog', { name: 'We have a winner!' }).getByText('Alice', { exact: true })).toBeVisible();
});
