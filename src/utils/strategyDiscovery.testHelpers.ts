import type { PersonalStrategyProfile, StrategyGoal, StrategyDiscoveryTopic } from '../types';
import { applyStrategyResponse, createPersonalStrategyProfile } from './personalStrategy';
import { preparePersonalDiscoveryRequest } from './strategyDiscovery';

export const discoveryStatements: Record<StrategyDiscoveryTopic, string> = {
  direction: 'Хочу більше свободи вибору роботи.',
  motivation: 'Це важливо для мене заради незалежності.',
  circumstances: 'Я працюю на повний день.',
  barriers: 'Коли сідаю починати справу, боюсь незрозумілого першого кроку.',
  capacity: 'Маю 30 хвилин увечері і можу виділити їх на цю справу.',
  attempts: 'Ще нічого не пробував.',
};
export const discoveryGoal: StrategyGoal = { id: 'g', title: 'Свобода вибору роботи', motive: 'Незалежність', agreed: false, taskIds: [], categoryIds: ['work'] };
export function understandingProfile(goals: StrategyGoal[] = [discoveryGoal]): PersonalStrategyProfile {
  let profile = { ...createPersonalStrategyProfile(), goals: goals.map(goal => ({ ...goal, agreed: false })) };
  for (const [index, topic] of (Object.keys(discoveryStatements) as StrategyDiscoveryTopic[]).entries()) {
    profile = applyStrategyResponse(profile, { memoryPatch: { discovery: {
      answers: [{ topic, status: 'answered', quote: discoveryStatements[topic] }], selectedGoalIds: goals.map(goal => goal.id),
      ...(topic === 'attempts' ? { summary: 'Ви хочете свободи вибору роботи, цінуєте незалежність і маєте 30 хвилин. Почати заважає незрозумілий перший крок. Правильно я вас зрозумів?' } : {}),
    } } }, discoveryStatements[topic], `discovery-${index}`);
  }
  return profile;
}
export function confirmedProfile(goals: StrategyGoal[] = [discoveryGoal]): PersonalStrategyProfile {
  const profile = understandingProfile(goals);
  return preparePersonalDiscoveryRequest(profile, 'Так.', profile.discovery?.pendingSummary?.id).profile;
}
