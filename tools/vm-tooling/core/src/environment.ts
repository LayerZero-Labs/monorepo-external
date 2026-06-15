import { env } from 'node:process';

const parseBoolean = (value: string | undefined): boolean => !!value && !!JSON.parse(value);

export const local: boolean = parseBoolean(env.VM_TOOLING_LOCAL);
export const registry: string | undefined = env.VM_TOOLING_REGISTRY;
export const imageDirectory: string | undefined = env.VM_TOOLING_IMAGE_DIRECTORY;
