async page => {
  await page.getByRole('button', { name: 'Завдання', exact: true }).click();
  await page.getByRole('button', { name: 'Нова категорія', exact: true }).click();
  const category = page.getByRole('textbox', { name: 'Назва категорії', exact: true });
  await category.fill('QA focus');
  await category.press('Escape');
  if (!await page.getByRole('button', { name: 'Нова категорія', exact: true }).evaluate(node => node === document.activeElement)) throw Error('Category focus not restored');
  await page.getByRole('button', { name: 'Пошук', exact: true }).click();
  const search = page.getByRole('searchbox');
  await search.fill('QA focus');
  await search.press('Escape');
  await page.waitForFunction(() => document.activeElement?.id === 'pulse-search-btn');
  console.log('PASS category and search focus, Escape restores triggers');
}
