import { test, expect } from '@playwright/test';

test('aligns the selected label with the left marker after a spin and reload', async ({ page, request }) => {
  const name = `Wheel ${Date.now()}`;
  const event = await (await request.post('/api/tournaments', { data: { name, pin: '1234' } })).json();
  const root = `/api/tournaments/${event.id}`, headers = { Authorization: `Bearer ${event.token}` };
  const stage = await (await request.post(`${root}/stages`, { headers, data: { name: 'Games', kind: 'two-station', participantCount: null } })).json();
  const games = ['Pong', 'A much longer game title', 'Out Run'].map(name => ({ name, resultKind: 'score', higherIsBetter: true, attempts: 1 }));
  await request.put(`${root}/stages/${stage.id}/settings`, { headers, data: { stations: [{ games }, { games: [] }], points: [1] } });
  await page.goto('/'); await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Wheel 1', exact: true }).click();
  const panel = page.getByLabel('Station 1 wheel');
  await page.evaluate(() => document.fonts.ready);
  const shortSize = await panel.locator('.wheel-label').filter({ hasText: 'Pong' }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const longSize = await panel.locator('.wheel-label').filter({ hasText: 'A much longer game title' }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(shortSize).toBeGreaterThan(longSize);
  await panel.getByRole('button', { name: 'Spin', exact: true }).click();
  await expect(panel.getByText(/^Drawn:/)).toBeVisible({ timeout: 8000 });
  await expect(panel.getByRole('button', { name: 'Confirm game' })).toBeEnabled();
  const draw = (await (await request.get(root)).json()).stages[0].draws[0];
  async function check() {
    const geometry = await panel.evaluate((element, index) => {
      const wheel = element.querySelector('.wheel')!, label = element.querySelectorAll('.wheel-label')[index]!, pointer = element.querySelector('.wheel-pointer')!;
      const wheelBox = element.querySelector('.wheel-shell')!.getBoundingClientRect(), labelBox = label.getBoundingClientRect(), pointerBox = pointer.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(getComputedStyle(wheel).transform).multiply(new DOMMatrixReadOnly(getComputedStyle(label).transform));
      return { angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI, pointerX: pointerBox.left, pointerY: pointerBox.top + pointerBox.height / 2, wheelX: wheelBox.left, centerX: wheelBox.left + wheelBox.width / 2, centerY: wheelBox.top + wheelBox.height / 2, labelX: labelBox.left, labelY: labelBox.top + labelBox.height / 2 };
    }, draw.gameIndex);
    expect(Math.abs(geometry.angle)).toBeLessThan(0.1);
    expect(Math.abs(geometry.pointerY - geometry.centerY)).toBeLessThan(2);
    expect(geometry.pointerX).toBeLessThan(geometry.wheelX);
    expect(geometry.labelX).toBeLessThan(geometry.centerX);
    expect(Math.abs(geometry.labelY - geometry.centerY)).toBeLessThan(2);
  }
  await check();
  await panel.getByRole('button', { name: 'Confirm game' }).click();
  await expect(panel.getByText(/^Selected:/)).toBeVisible();
  await page.reload(); await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: 'Wheel 1', exact: true }).click();
  await expect(panel.getByText(/^Selected:/)).toBeVisible();
  await check();
});
