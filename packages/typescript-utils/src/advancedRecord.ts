export type AdvancedRecord<T = any, U = any> = {
    readonly [key: string]: readonly [T, U];
};

export type DeepWritable<T> = { -readonly [P in keyof T]: DeepWritable<T[P]> };

export type AdvancedRecordLookup<
    AR extends AdvancedRecord | undefined,
    KeyToFind,
> = AR extends AdvancedRecord
    ? {
          [P in keyof AR]: AR[P] extends readonly [infer K, infer V]
              ? // Distribute on K
                K extends unknown
                  ? KeyToFind extends DeepWritable<K>
                      ? V
                      : DeepWritable<K> extends KeyToFind
                        ? V
                        : never
                  : never
              : never;
      }[keyof AR]
    : never;
