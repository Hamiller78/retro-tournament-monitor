import { test, expect } from '@playwright/test';

test('navigation reflects whether a two-station stage exists', async ({ page, request }) => {
  const name = `Navigation ${Date.now()}`;
  const created = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${created.id}`, headers = { Authorization: `Bearer ${created.token}` };
  await request.post(`${root}/stages`, { headers, data: { name: 'Elimination', kind: 'elimination', participantCount: 4 } });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Tournament views' });
  await expect(nav.getByRole('button', { name: 'Elimination', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Progression', exact: true })).toBeVisible();
  const stationTabs = ['Wheel 1', 'Wheel 2', 'Station 1', 'Station 2', 'Leaderboard'];
  for (const tab of stationTabs) await expect(nav.getByRole('button', { name: tab, exact: true })).toHaveCount(0);
  const scoring = await (await request.post(`${root}/stages`, { headers, data: { name: 'Scoring', kind: 'two-station', participantCount: 4 } })).json();
  for (const tab of stationTabs) await expect(nav.getByRole('button', { name: tab, exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Leaderboard', exact: true }).click();
  expect((await request.delete(`${root}/stages/${scoring.id}`, { headers })).ok()).toBe(true);
  for (const tab of stationTabs) await expect(nav.getByRole('button', { name: tab, exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Setup', exact: true })).toHaveAttribute('aria-current', 'page');
});
