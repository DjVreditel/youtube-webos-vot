import { initVotTranslation } from './translation';
import { initVotPanel } from './ui';
import { initPerfMode } from './perf-mode';

export function initVot() {
  initPerfMode();
  void initVotTranslation();
  initVotPanel();
}
