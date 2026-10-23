import { initVotTranslation } from './translation';
import { initVotPanel } from './ui';
import { initVotSubtitles } from './subtitles';
import { installSabrCapture } from './sabr';

export function initVot() {
  installSabrCapture();
  const start = () => {
    void initVotTranslation();
    void initVotSubtitles();
    initVotPanel();
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
