export const timestampToMs = (timestamp: { seconds: bigint; nanos?: number }): string =>
    (timestamp.seconds * 1000n + BigInt(timestamp.nanos ?? 0) / 1_000_000n).toString();
