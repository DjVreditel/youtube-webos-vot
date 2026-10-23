import { initVotTranslation } from './translation';
import { initVotPanel } from './ui';

export function initVot() {
  const start = () => {
    void initVotTranslation();
    initVotPanel();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
