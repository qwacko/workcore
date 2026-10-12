import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const exampleDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDirectory = resolve(exampleDirectory, '../..');

// Shell-provided values win; otherwise prefer the example's .env over the repo-root .env.
config({ path: [resolve(exampleDirectory, '.env'), resolve(repositoryDirectory, '.env')] });
