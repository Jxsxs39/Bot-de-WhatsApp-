import {createProcessSupervisor} from './process-supervisor.js';

const supervisor=createProcessSupervisor();
process.once('SIGINT',()=>supervisor.stop());
process.once('SIGTERM',()=>supervisor.stop());
supervisor.start();
