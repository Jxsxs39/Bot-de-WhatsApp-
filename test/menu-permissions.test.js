import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleAdminNames,adminNames} from '../commands/admin.js';
import {commands} from '../commands/index.js';
test('menús según permisos',async()=>{assert.deepEqual(visibleAdminNames(0),[]);assert.ok(visibleAdminNames(90).includes('reload'));assert.ok(!visibleAdminNames(90).includes('setcode'));assert.deepEqual(visibleAdminNames(100),[...adminNames]);let output;const id='584149164536@s.whatsapp.net';const ctx={commands,userId:id,chatId:id,reply:async s=>{output=s;}};await commands.get('menu').run(ctx);assert.match(output,/\.setcode/);await commands.get('menu').run({...ctx,chatId:'123@g.us'});assert.doesNotMatch(output,/\.setcode|\.admin/);});
