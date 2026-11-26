import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {clearWhatsAppAuthState} from '../whatsapp-session.js';

test('clears only a dedicated WhatsApp auth directory',async()=>{
 const temporaryDirectory=await mkdtemp(path.join(os.tmpdir(),'historia-auth-'));
 const authDirectory=path.join(temporaryDirectory,'session');
 try {
  await mkdir(authDirectory);
  await writeFile(path.join(authDirectory,'creds.json'),'{}');
  await clearWhatsAppAuthState(authDirectory);
  await assert.rejects(access(authDirectory));
 } finally {
  await rm(temporaryDirectory,{recursive:true,force:true});
 }
});

test('refuses to delete the project directory or filesystem root',async()=>{
 const filesystemRoot=path.parse(process.cwd()).root;
 await assert.rejects(clearWhatsAppAuthState(process.cwd()),/no es seguro/);
 await assert.rejects(clearWhatsAppAuthState(path.dirname(process.cwd())),/no es seguro/);
 await assert.rejects(clearWhatsAppAuthState(filesystemRoot),/no es seguro/);
});
