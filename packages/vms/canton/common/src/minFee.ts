import { z } from 'zod';

import { canonicalizeDamlDecimal } from './types';

const minFeeArgSchema = z.object({ minFee: z.string() });

/**
 * Extract and canonicalize the `minFee` Daml Decimal from an IMinFee contract's
 * `createArgument`. Throws a ZodError if the shape doesn't match.
 */
export const parseMinFeeValue = (createArgument: unknown): string =>
    canonicalizeDamlDecimal(minFeeArgSchema.parse(createArgument).minFee);
