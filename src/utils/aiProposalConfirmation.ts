/** Standalone, explicit requests to apply a prepared proposal. A casual yes is not authorization. */
export function isExplicitAIProposalApplyRequest(text: string): boolean {
  const request = text.trim().toLowerCase().replace(/[.!]+$/u, '').trim()
    .replace(/^(?:будь ласка|please)[,\s]+/u, '').replace(/[,\s]+(?:будь ласка|please)$/u, '').trim();
  return /^(?:застосуй(?:те)?|застосувати)(?:\s+(?:(?:ці|запропоновані|підготовлені)\s+)?(?:зміни|пропозицію|план))?$/u.test(request)
    || /^(?:збережи|збережіть|зберегти|підтверди|підтвердіть|підтвердити)(?:\s+(?:ці|запропоновані|підготовлені))?\s+(?:зміни|пропозицію|план)$/u.test(request)
    || /^apply(?:\s+(?:(?:the|these|proposed|prepared)\s+)?(?:changes|proposal|plan))?$/u.test(request)
    || /^(?:save|confirm)(?:\s+(?:the|these|proposed|prepared))?\s+(?:changes|proposal|plan)$/u.test(request);
}
