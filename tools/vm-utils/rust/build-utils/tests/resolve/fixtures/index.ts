import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = new URL('.', import.meta.url).pathname;

export const fixture = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8');
