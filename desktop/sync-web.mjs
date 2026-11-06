// Copies the built web app (web/app/dist) into ./app-dist.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../web/app/dist', import.meta.url));
const to = fileURLToPath(new URL('./app-dist', import.meta.url));
if (!existsSync(from)) throw new Error(`Build the web app first: ${from} doesn't exist.`);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('Copied the web build to app-dist.');
