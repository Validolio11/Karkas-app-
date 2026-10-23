async page => {
  await page.getByRole('button', { name: 'Продовжити', exact: true }).click();
  await page.getByRole('button', { name: 'Блокнот', exact: true }).click();
  await page.getByRole('button', { name: 'Нова нотатка', exact: true }).click();
  await page.getByRole('textbox', { name: 'Назва нотатки', exact: true }).fill('QA Production note');
  await page.getByRole('textbox', { name: 'Текст сторінки', exact: true }).fill('QA production text');
  await page.getByRole('button', { name: 'Оформлений вигляд', exact: true }).click();
  await page.reload();
  const text = page.getByRole('textbox', { name: 'Текст сторінки', exact: true });
  await text.waitFor();
  if (await text.inputValue() !== 'QA production text') throw new Error('Production notebook reload');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/release-2026-10-23/production-mobile.png', fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Production horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Навички', exact: true }).click();
  await page.getByRole('button', { name: '+ Своя', exact: true }).click();
  await page.getByRole('textbox', { name: 'Назва навички', exact: true }).fill('QA Production skill');
  await page.getByRole('button', { name: 'Створити навичку', exact: true }).click();
  await page.getByRole('button', { name: 'Записати практику', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Запис результату', exact: true });
  await panel.getByRole('textbox', { name: 'Висновок', exact: true }).fill('QA production result');
  await panel.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByText('QA production result', { exact: true }).waitFor();
  const bundle = await page.locator('script[type=module][src]').first().getAttribute('src');
  if (!bundle.includes('/assets/')) throw new Error('Not testing a production bundle');
  await page.screenshot({ path: 'output/playwright/release-2026-10-23/production-skill.png', fullPage: true });
  console.log('PASS: production bundle, persisted notebook, mobile layout, skill and autosaved practice');
}
