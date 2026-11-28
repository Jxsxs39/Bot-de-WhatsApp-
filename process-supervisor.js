import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const DEFAULT_RUNTIME_PATH=fileURLToPath(new URL('./bot-runtime.js',import.meta.url));

export function createProcessSupervisor({
  spawnProcess=spawn,
  runtimePath=DEFAULT_RUNTIME_PATH,
  restartIntervalMs=30*60*1000,
  retryDelayMs=5_000,
  shutdownTimeoutMs=15_000,
  setTimer=setTimeout,
  clearTimer=clearTimeout,
  logger=console
}={}) {
  let child,restartTimer,retryTimer,forceKillTimer,stopping=false;

  const clearTimers=()=>{
    clearTimer(restartTimer);
    clearTimer(retryTimer);
    clearTimer(forceKillTimer);
    restartTimer=retryTimer=forceKillTimer=undefined;
  };

  const startRuntime=()=>{
    if(stopping||child) return;
    let runtime;
    try {
      runtime=spawnProcess(process.execPath,[runtimePath],{stdio:'inherit',env:process.env});
    } catch(error) {
      logger.error('[SUPERVISOR] No se pudo iniciar el bot:',error?.message||error?.name||'Error');
      retryTimer=setTimer(startRuntime,retryDelayMs);
      return;
    }

    child=runtime;
    runtime.once('spawn',()=>{
      if(stopping||child!==runtime) return;
      logger.log('[SUPERVISOR] Proceso del bot iniciado.');
      restartTimer=setTimer(()=>{
        restartTimer=undefined;
        if(stopping||child!==runtime) return;
        logger.log('[SUPERVISOR] Reinicio programado del bot (30 minutos).');
        runtime.kill('SIGTERM');
        forceKillTimer=setTimer(()=>{
          if(child!==runtime) return;
          logger.error('[SUPERVISOR] El bot no cerró a tiempo; forzando el reinicio.');
          runtime.kill('SIGKILL');
        },shutdownTimeoutMs);
      },restartIntervalMs);
    });
    runtime.once('error',error=>{
      logger.error('[SUPERVISOR] Error del proceso del bot:',error?.message||error?.name||'Error');
    });
    runtime.once('close',(code,signal)=>{
      if(child!==runtime) return;
      clearTimers();
      child=undefined;
      if(stopping) return;
      logger.error('[SUPERVISOR] El proceso del bot terminó; se iniciará de nuevo.',code,signal||'sin señal');
      retryTimer=setTimer(startRuntime,retryDelayMs);
    });
  };

  const stop=()=>{
    if(stopping) return;
    stopping=true;
    clearTimers();
    if(!child) return;
    const runtime=child;
    runtime.kill('SIGTERM');
    forceKillTimer=setTimer(()=>{
      if(child===runtime) runtime.kill('SIGKILL');
    },shutdownTimeoutMs);
  };

  return {start:startRuntime,stop};
}
