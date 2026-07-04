import { initVotTranslation } from './translation';
import { initVotPanel } from './ui';

export function initVot() {
  void initVotTranslation();
  initVotPanel();
}
