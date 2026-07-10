type StoreValue = {
    type: 'value';
    value: any;
};
type StoreFactory = {
    type: 'factory';
    value: () => any;
};
type StoreAny = StoreValue | StoreFactory;

export class DependencyStore {
    private store: Record<string, StoreAny | undefined> = {};

    private throwIfRegistered(key: string) {
        if (this.store[key] != null) {
            throw new Error(`${key} is already registered`);
        }
    }

    private throwIfUnregistered(key: string) {
        if (this.store[key] == null) {
            throw new Error(`${key} is not registered`);
        }
    }

    /** Registers a value that will be resolved literally by resolve()
     * @throws if already registered
     */
    public register<T>(key: string, value: T extends Promise<any> ? never : T) {
        this.throwIfRegistered(key);
        this.store[key] = { type: 'value', value };
    }

    /** Registers a promise value that will be resolved literally by resolve()
     * @throws if already registered
     */
    public registerPromise(key: string, value: Promise<any>) {
        this.throwIfRegistered(key);
        this.store[key] = { type: 'value', value };
    }

    /** Registers a factory function that will be called by resolve()
     * @throws if already registered
     */
    public registerFactory(key: string, factory: () => any) {
        this.throwIfRegistered(key);
        this.store[key] = { type: 'factory', value: factory };
    }

    /** Unregisters a key
     * @throws if not registered
     */
    public unregister(key: string) {
        this.throwIfUnregistered(key);
        this.store[key] = undefined;
    }

    /**
     * Drops all registered values
     */
    public invalidate() {
        this.store = {};
    }

    /** Resolves a key to a value */
    public resolve(key: string) {
        this.throwIfUnregistered(key);
        const stored = this.store[key]!;
        return stored.type === 'factory' ? stored.value() : stored.value;
    }
}
