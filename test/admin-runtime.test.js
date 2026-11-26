import test from 'node:test';
import assert from 'node:assert/strict';
import {commands,reloadCommands} from '../commands/index.js';
import {audit,readAudit} from '../admin-audit.js';
test('recarga conserva comandos',async()=>{const names=[...commands.keys()];await reloadCommands();assert.deepEqual([...commands.keys()],names);});
test('registro acotado',()=>{for(let i=0;i<50;i++)audit('evento');assert.equal(readAudit().length,20);});
