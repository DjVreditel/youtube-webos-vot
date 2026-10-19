import { extractLaunchParams, handleLaunch } from './launch.js';
import { whenOnline } from './wait-for-network.js';

function main() {
  let params = extractLaunchParams();
  // A relaunch while waiting for the network (a deep link, a voice search) wins.
  document.addEventListener('webOSRelaunch', (evt) => {
    if (evt.detail && typeof evt.detail === 'object') params = evt.detail;
  }, true);
  whenOnline(() => handleLaunch(params));
}

main();
