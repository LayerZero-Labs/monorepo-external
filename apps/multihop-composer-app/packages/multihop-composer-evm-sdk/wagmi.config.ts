import { createWagmiConfigs } from '@layerzerolabs/wagmi-config';
import path from 'path';

const artifactsPackage = path.dirname(
    import.meta.resolve('@layerzerolabs/multihop-composer-evm-contracts/package.json'),
);
export default createWagmiConfigs([
    {
        artifactsPackageFolder: artifactsPackage,
    },
]);
