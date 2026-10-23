async page => {
  await page.getByRole('textbox', { name: 'Назва категорії', exact: true }).fill('QA History');
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Нова задача', exact: true });
  const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem('karkas_workspace:guest')).workspace);
  const counts = async () => {
    const workspace = await snapshot();
    return { records: workspace.tasks.filter(task => task.done).length,
      total: Object.values(workspace.settings.completionLedger).filter(receipt => receipt.counted).length };
  };
  for (let index = 1; index <= 51; index++) {
    const title = 'QA History ' + String(index).padStart(3, '0');
    await input.fill(title);
    await input.press('Enter');
    if (!await input.evaluate(element => element === document.activeElement && element.value === '')) throw new Error('Continuous input lost focus');
    await page.getByRole('checkbox', { name: 'Виконано: ' + title, exact: true }).click();
    await page.waitForFunction(title => JSON.parse(localStorage.getItem('karkas_workspace:guest')).workspace.tasks.some(task => task.title === title && task.done), title);
  }
  let result = await counts();
  if (result.records !== 50 || result.total !== 51) throw new Error('51 boundary ' + JSON.stringify(result));
  await page.getByRole('button', { name: 'Скасувати', exact: true }).click();
  result = await counts();
  const restored = await snapshot();
  if (result.records !== 50 || result.total !== 50 || !restored.tasks.some(task => task.title === 'QA History 001' && task.done)) throw new Error('Retention Undo ' + JSON.stringify(result));
  await page.getByRole('checkbox', { name: 'Виконано: QA History 051', exact: true }).click();
  await page.reload();
  await page.getByText('0 хв фокусу · Завершено задач: 51', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Архів у налаштуваннях · 50', exact: true }).click();
  if (await page.getByRole('listitem').count() !== 50) throw new Error('Archive must retain 50 full records');
  await page.screenshot({ path: 'output/playwright/release-2026-10-23/archive-50.png', fullPage: true });
  await page.getByRole('button', { name: 'Акаунт Гість · локально', exact: true }).click();
  await page.getByText('Завершено завдань', { exact: true }).waitFor();
  await page.getByText('51', { exact: true }).waitFor();
  console.log('PASS: 51 completions / 50 records, exact Undo restores oldest retained record, reload and lifetime account count 51');
}
