import {workerHealthy} from '../../engine/src/worker-runtime.ts';
const ready=workerHealthy(process.env.FACTORYZE_BROWSER_WORKER_HEALTH_FILE??'');
console.log(JSON.stringify({ready}));if(!ready)process.exitCode=1;
