import { z } from 'zod';

export enum LZFinality {
    REAL_TIME = 'real_time',
    LISTENER_FINAL = 'listener_final',
    MINED_FINAL = 'mined_final',
    STATE_FINAL = 'state_final',
}

export const LZFinalitySchema = z.enum(LZFinality);
