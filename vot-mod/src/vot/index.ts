import { initVotTranslation } from './translation';
import { initVotPanel } from './ui';
import { initVotSubtitles } from './subtitles';

export function initVot() {
  const start = () => {
    void initVotTranslation();
    void initVotSubtitles();
    initVotPanel();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
