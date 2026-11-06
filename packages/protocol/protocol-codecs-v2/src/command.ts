abstract class Codec {
    protected byteLength = 0;

    getByteLength(): number {
        return this.byteLength;
    }

    getHexLength(): number {
        return this.byteLength * 2;
    }

    abstract encode(): string;
}

export enum TimestampBlockConfiguration {
    Timestamp = 0,
    BlockNumber = 1,
}

export enum ResolverType {
    SingleViewFunctionEVMCall = 1,
}

export enum ComputeSetting {
    OnlyMap = 0,
    OnlyReduce = 1,
    MapReduce = 2,
}

export enum ComputeType {
    SingleViewFunctionEVMCall = 1,
}

export interface EVMTimestamp {
    timestamp: bigint;
}

export interface EVMBlock {
    blockNumber: bigint;
}

export interface CommandRequest extends Codec {
    requestHeader: RequestHeader;
}

export interface Compute extends Codec {
    computeHeader: ComputeHeader;
}

const hexToNumber = (hex: string): number => parseInt(hex, 16);

const hexToBigInt = (hex: string): bigint => BigInt(`0x${hex}`);

const toHex = (value: number | bigint, bytes: number): string => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new Error(`${value} is not an integer`);
    }
    const n = BigInt(value);
    if (n < 0n || n >= 1n << BigInt(bytes * 8)) {
        throw new Error(`${value} does not fit in ${bytes} bytes`);
    }
    return n.toString(16).padStart(bytes * 2, '0');
};

const padHex = (hex: string, bytes: number): string => {
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
        throw new Error(`${hex} is not unprefixed hex`);
    }
    if (hex.length > bytes * 2) {
        throw new Error(`${hex} is longer than ${bytes} bytes`);
    }
    return hex.padStart(bytes * 2, '0');
};

const readHex = (hex: string, offset: number, bytes: number): string => {
    const slice = hex.slice(offset, offset + bytes * 2);
    if (slice.length !== bytes * 2) {
        throw new Error(`Command ends before offset ${offset / 2 + bytes}`);
    }
    if (!/^[0-9a-fA-F]*$/.test(slice)) {
        throw new Error(`Command has bytes that are not hex at offset ${offset / 2}`);
    }
    return slice;
};

const checkVersion = (name: string, version: number): void => {
    if (version !== 1) {
        throw new Error(`Invalid ${name} ${version}`);
    }
};

export class Header extends Codec {
    private static readonly GLOBAL_VERSION_BYTES = 2;
    private static readonly APP_COMMAND_LABEL_BYTES = 2;
    private static readonly REQUEST_COUNT_BYTES = 2;

    constructor(
        public globalVersion: number,
        public appCommandLabel: string,
        public requestCount: number,
    ) {
        super();
        this.byteLength =
            Header.GLOBAL_VERSION_BYTES +
            Header.APP_COMMAND_LABEL_BYTES +
            Header.REQUEST_COUNT_BYTES;
    }

    encode(): string {
        return (
            toHex(this.globalVersion, Header.GLOBAL_VERSION_BYTES) +
            padHex(this.appCommandLabel, Header.APP_COMMAND_LABEL_BYTES) +
            toHex(this.requestCount, Header.REQUEST_COUNT_BYTES)
        );
    }

    static decode(hex: string, offset = 0): Header {
        let cursor = offset;
        const globalVersion = hexToNumber(readHex(hex, cursor, Header.GLOBAL_VERSION_BYTES));
        cursor += Header.GLOBAL_VERSION_BYTES * 2;
        const appCommandLabel = readHex(hex, cursor, Header.APP_COMMAND_LABEL_BYTES);
        cursor += Header.APP_COMMAND_LABEL_BYTES * 2;
        const requestCount = hexToNumber(readHex(hex, cursor, Header.REQUEST_COUNT_BYTES));
        checkVersion('command version', globalVersion);
        return new Header(globalVersion, appCommandLabel, requestCount);
    }
}

export class RequestHeader extends Codec {
    private static readonly REQUEST_VERSION_BYTES = 1;
    private static readonly APP_REQUEST_LABEL_BYTES = 2;
    private static readonly RESOLVER_TYPE_BYTES = 2;
    private static readonly REQUEST_SIZE_BYTES = 2;

    constructor(
        public requestVersion: number,
        public appRequestLabel: string,
        public resolverType: ResolverType,
        public requestSize: number,
    ) {
        super();
        this.byteLength =
            RequestHeader.REQUEST_VERSION_BYTES +
            RequestHeader.APP_REQUEST_LABEL_BYTES +
            RequestHeader.RESOLVER_TYPE_BYTES +
            RequestHeader.REQUEST_SIZE_BYTES;
    }

    encode(): string {
        return (
            toHex(this.requestVersion, RequestHeader.REQUEST_VERSION_BYTES) +
            padHex(this.appRequestLabel, RequestHeader.APP_REQUEST_LABEL_BYTES) +
            toHex(this.resolverType, RequestHeader.RESOLVER_TYPE_BYTES) +
            toHex(this.requestSize, RequestHeader.REQUEST_SIZE_BYTES)
        );
    }

    static decode(hex: string, offset = 0): RequestHeader {
        let cursor = offset;
        const requestVersion = hexToNumber(
            readHex(hex, cursor, RequestHeader.REQUEST_VERSION_BYTES),
        );
        cursor += RequestHeader.REQUEST_VERSION_BYTES * 2;
        const appRequestLabel = readHex(hex, cursor, RequestHeader.APP_REQUEST_LABEL_BYTES);
        cursor += RequestHeader.APP_REQUEST_LABEL_BYTES * 2;
        const resolverType = hexToNumber(readHex(hex, cursor, RequestHeader.RESOLVER_TYPE_BYTES));
        cursor += RequestHeader.RESOLVER_TYPE_BYTES * 2;
        const requestSize = hexToNumber(readHex(hex, cursor, RequestHeader.REQUEST_SIZE_BYTES));
        checkVersion('request version', requestVersion);
        return new RequestHeader(requestVersion, appRequestLabel, resolverType, requestSize);
    }
}

export class EVMBase extends Codec {
    private static readonly TARGET_EID_BYTES = 4;
    private static readonly TIMESTAMP_BLOCK_FLAG_BYTES = 1;
    private static readonly BLOCK_CONFIRMATIONS_BYTES = 2;
    private static readonly TO_BYTES = 20;
    private static readonly TIMESTAMP_BYTES = 8;
    private static readonly BLOCK_NUMBER_BYTES = 8;

    static readonly FIXED_BYTES =
        EVMBase.TARGET_EID_BYTES +
        EVMBase.TIMESTAMP_BLOCK_FLAG_BYTES +
        EVMBase.BLOCK_CONFIRMATIONS_BYTES +
        EVMBase.TO_BYTES +
        EVMBase.TIMESTAMP_BYTES;

    protected constructor(
        public targetEid: number,
        public timestampBlockFlag: TimestampBlockConfiguration,
        public blockConfirmations: number,
        public to: string,
        public timestamp?: bigint,
        public blockNumber?: bigint,
    ) {
        super();
        this.byteLength =
            EVMBase.TARGET_EID_BYTES +
            EVMBase.TIMESTAMP_BLOCK_FLAG_BYTES +
            EVMBase.BLOCK_CONFIRMATIONS_BYTES +
            EVMBase.TO_BYTES +
            (timestamp !== undefined ? EVMBase.TIMESTAMP_BYTES : 0) +
            (blockNumber !== undefined ? EVMBase.BLOCK_NUMBER_BYTES : 0);
    }

    encode(): string {
        if (this.timestamp !== undefined && this.blockNumber !== undefined) {
            throw new Error('Cannot have both timestamp and block number');
        }
        const blockOrTimestamp =
            this.blockNumber !== undefined
                ? toHex(this.blockNumber, EVMBase.BLOCK_NUMBER_BYTES)
                : this.timestamp !== undefined
                  ? toHex(this.timestamp, EVMBase.TIMESTAMP_BYTES)
                  : undefined;
        if (blockOrTimestamp === undefined) {
            throw new Error('Either block number or timestamp must be set');
        }
        if (
            (this.timestampBlockFlag === TimestampBlockConfiguration.BlockNumber) !==
            (this.blockNumber !== undefined)
        ) {
            throw new Error('timestampBlockFlag does not match the timestamp or block number set');
        }
        return (
            toHex(this.targetEid, EVMBase.TARGET_EID_BYTES) +
            toHex(this.timestampBlockFlag, EVMBase.TIMESTAMP_BLOCK_FLAG_BYTES) +
            blockOrTimestamp +
            toHex(this.blockConfirmations, EVMBase.BLOCK_CONFIRMATIONS_BYTES) +
            padHex(this.to, EVMBase.TO_BYTES)
        );
    }

    static decode(hex: string, offset = 0): EVMBase {
        let cursor = offset;
        const targetEid = hexToNumber(readHex(hex, cursor, EVMBase.TARGET_EID_BYTES));
        cursor += EVMBase.TARGET_EID_BYTES * 2;
        const timestampBlockFlag: TimestampBlockConfiguration = hexToNumber(
            readHex(hex, cursor, EVMBase.TIMESTAMP_BLOCK_FLAG_BYTES),
        );
        cursor += EVMBase.TIMESTAMP_BLOCK_FLAG_BYTES * 2;
        let timestamp: bigint | undefined;
        let blockNumber: bigint | undefined;
        if (timestampBlockFlag === TimestampBlockConfiguration.BlockNumber) {
            blockNumber = hexToBigInt(readHex(hex, cursor, EVMBase.BLOCK_NUMBER_BYTES));
            cursor += EVMBase.BLOCK_NUMBER_BYTES * 2;
        } else {
            timestamp = hexToBigInt(readHex(hex, cursor, EVMBase.TIMESTAMP_BYTES));
            cursor += EVMBase.TIMESTAMP_BYTES * 2;
        }
        const blockConfirmations = hexToNumber(
            readHex(hex, cursor, EVMBase.BLOCK_CONFIRMATIONS_BYTES),
        );
        cursor += EVMBase.BLOCK_CONFIRMATIONS_BYTES * 2;
        const to = readHex(hex, cursor, EVMBase.TO_BYTES);
        return new EVMBase(
            targetEid,
            timestampBlockFlag,
            blockConfirmations,
            to,
            timestamp,
            blockNumber,
        );
    }
}

export class SingleViewFunctionEVMCall extends EVMBase implements CommandRequest {
    constructor(
        public requestHeader: RequestHeader,
        targetEid: number,
        timestampBlockFlag: TimestampBlockConfiguration,
        blockConfirmations: number,
        to: string,
        public calldata: string,
        timestamp?: bigint,
        blockNumber?: bigint,
    ) {
        super(targetEid, timestampBlockFlag, blockConfirmations, to, timestamp, blockNumber);
        this.byteLength = requestHeader.getByteLength() + requestHeader.requestSize;
    }

    override encode(): string {
        if (!/^([0-9a-fA-F]{2})*$/.test(this.calldata)) {
            throw new Error('calldata must be unprefixed hex of whole bytes');
        }
        const actualSize = EVMBase.FIXED_BYTES + this.calldata.length / 2;
        if (this.requestHeader.requestSize !== actualSize) {
            throw new Error(
                `requestSize ${this.requestHeader.requestSize} does not match the request's ${actualSize} bytes`,
            );
        }
        return this.requestHeader.encode() + super.encode() + this.calldata;
    }

    static override decode(hex: string, offset = 0): SingleViewFunctionEVMCall {
        let cursor = offset;
        const requestHeader = RequestHeader.decode(hex, cursor);
        cursor += requestHeader.getHexLength();
        const evmBase = EVMBase.decode(hex, cursor);
        cursor += evmBase.getHexLength();
        const calldataBytes = requestHeader.requestSize - evmBase.getByteLength();
        if (calldataBytes < 0) {
            throw new Error(`requestSize ${requestHeader.requestSize} is too small`);
        }
        const calldata = readHex(hex, cursor, calldataBytes);
        return new SingleViewFunctionEVMCall(
            requestHeader,
            evmBase.targetEid,
            evmBase.timestampBlockFlag,
            evmBase.blockConfirmations,
            evmBase.to,
            calldata,
            evmBase.timestamp,
            evmBase.blockNumber,
        );
    }
}

export class ComputeHeader extends Codec {
    private static readonly COMPUTE_VERSION_BYTES = 1;
    private static readonly COMPUTE_TYPE_BYTES = 2;
    private static readonly COMPUTE_SETTING_BYTES = 1;

    constructor(
        public computeVersion: number,
        public computeType: ComputeType,
        public computeSetting: ComputeSetting,
    ) {
        super();
        this.byteLength =
            ComputeHeader.COMPUTE_VERSION_BYTES +
            ComputeHeader.COMPUTE_TYPE_BYTES +
            ComputeHeader.COMPUTE_SETTING_BYTES;
    }

    encode(): string {
        return (
            toHex(this.computeVersion, ComputeHeader.COMPUTE_VERSION_BYTES) +
            toHex(this.computeType, ComputeHeader.COMPUTE_TYPE_BYTES) +
            toHex(this.computeSetting, ComputeHeader.COMPUTE_SETTING_BYTES)
        );
    }

    static decode(hex: string, offset = 0): ComputeHeader {
        let cursor = offset;
        const computeVersion = hexToNumber(
            readHex(hex, cursor, ComputeHeader.COMPUTE_VERSION_BYTES),
        );
        cursor += ComputeHeader.COMPUTE_VERSION_BYTES * 2;
        const computeType = hexToNumber(readHex(hex, cursor, ComputeHeader.COMPUTE_TYPE_BYTES));
        cursor += ComputeHeader.COMPUTE_TYPE_BYTES * 2;
        const computeSetting = hexToNumber(
            readHex(hex, cursor, ComputeHeader.COMPUTE_SETTING_BYTES),
        );
        checkVersion('compute version', computeVersion);
        if (computeSetting > ComputeSetting.MapReduce) {
            throw new Error(`Invalid compute setting ${computeSetting}`);
        }
        return new ComputeHeader(computeVersion, computeType, computeSetting);
    }
}

export class ComputeEVM extends EVMBase implements Compute {
    constructor(
        public computeHeader: ComputeHeader,
        targetEid: number,
        timestampBlockFlag: TimestampBlockConfiguration,
        blockConfirmations: number,
        to: string,
        timestamp?: bigint,
        blockNumber?: bigint,
    ) {
        super(targetEid, timestampBlockFlag, blockConfirmations, to, timestamp, blockNumber);
        this.byteLength += computeHeader.getByteLength();
    }

    override encode(): string {
        return this.computeHeader.encode() + super.encode();
    }

    static override decode(hex: string, offset = 0): ComputeEVM {
        let cursor = offset;
        const computeHeader = ComputeHeader.decode(hex, cursor);
        cursor += computeHeader.getHexLength();
        const evmBase = EVMBase.decode(hex, cursor);
        return new ComputeEVM(
            computeHeader,
            evmBase.targetEid,
            evmBase.timestampBlockFlag,
            evmBase.blockConfirmations,
            evmBase.to,
            evmBase.timestamp,
            evmBase.blockNumber,
        );
    }
}

export class Command extends Codec {
    constructor(
        public header: Header,
        public requests: CommandRequest[],
        public compute?: Compute,
    ) {
        super();
        this.byteLength =
            header.getByteLength() +
            requests.reduce((acc, req) => acc + req.getByteLength(), 0) +
            (compute ? compute.getByteLength() : 0);
    }

    encode(): string {
        if (this.requests.length === 0) {
            throw new Error('Command has no requests');
        }
        if (this.header.requestCount !== this.requests.length) {
            throw new Error(
                `requestCount ${this.header.requestCount} does not match the ${this.requests.length} requests`,
            );
        }
        const requests = this.requests.map((request) => {
            if (request.requestHeader.resolverType !== ResolverType.SingleViewFunctionEVMCall) {
                throw new Error('Invalid resolver type');
            }
            return request.encode();
        });
        if (
            this.compute &&
            this.compute.computeHeader.computeType !== ComputeType.SingleViewFunctionEVMCall
        ) {
            throw new Error('Invalid compute type');
        }
        return this.header.encode() + requests.join('') + (this.compute?.encode() ?? '');
    }

    static decode(hex: string, offset = 0): Command {
        let cursor = offset;
        const header = Header.decode(hex, cursor);
        cursor += header.getHexLength();
        if (header.requestCount === 0) {
            throw new Error('Command has no requests');
        }
        const requests: CommandRequest[] = [];
        for (let i = 0; i < header.requestCount; i++) {
            if (
                RequestHeader.decode(hex, cursor).resolverType !==
                ResolverType.SingleViewFunctionEVMCall
            ) {
                throw new Error('Invalid resolver type');
            }
            const request = SingleViewFunctionEVMCall.decode(hex, cursor);
            requests.push(request);
            cursor += request.getHexLength();
        }
        if (cursor === hex.length) {
            return new Command(header, requests);
        }
        if (
            ComputeHeader.decode(hex, cursor).computeType !== ComputeType.SingleViewFunctionEVMCall
        ) {
            throw new Error('Invalid compute type');
        }
        const compute = ComputeEVM.decode(hex, cursor);
        cursor += compute.getHexLength();
        if (cursor !== hex.length) {
            throw new Error('Command has trailing bytes after the compute');
        }
        return new Command(header, requests, compute);
    }
}
