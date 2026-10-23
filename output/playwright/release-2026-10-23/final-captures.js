async page => {
  const settle = async () => {
    await page.evaluate(async () => {
      for (let frame = 0; frame < 3; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {})));
      }
    });
  };
  await page.getByRole('button', { name: 'Навички', exact: true }).click();
  await settle();
  await page.screenshot({ path: 'output/playwright/release-2026-10-23/production-skill.png', fullPage: true });
  await page.getByRole('button', { name: 'Блокнот', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('Horizontal overflow');
  await page.screenshot({ path: 'output/playwright/release-2026-10-23/production-mobile.png', fullPage: true });
}
