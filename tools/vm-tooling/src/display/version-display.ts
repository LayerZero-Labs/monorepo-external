import type { ChainContext } from '../context';
import { findToolByName, getToolDefaultVersion, getToolSupportedVersions } from '../utils/finder';
import { formatVersionCombination } from './formatters';

/**
 * Display all supported version combinations
 */
export function displayVersionCombinations(context: ChainContext<string>): void {
    console.log('\n🚀 LayerZero VM Tool - Supported Version Combinations\n');

    const combinations = context.versionCombinations;
    const toolNames = [...new Set(combinations.flatMap(({ images }) => Object.keys(images)))]
        .sort()
        .join(', ');

    console.log(`📦 Tools: ${toolNames}`);
    console.log('─'.repeat(50));

    console.log('🎯 Default:');
    console.log(formatVersionCombination(context, combinations[0], true));
    console.log();

    // Show all combinations
    console.log('📋 All supported combinations:');
    for (const [index, combination] of combinations.entries()) {
        console.log(formatVersionCombination(context, combination, !index));
    }
    console.log();

    console.log('💡 Usage examples:');
    console.log('  lz-tool anchor --anchor-version 0.29.0 --solana-version 1.17.31 build');
    console.log(
        '  lz-tool anchor --anchor-version 0.31.1 build  # Auto-selects compatible solana version',
    );
    console.log();
}

/**
 * Display tool-specific version information
 */
export function displayToolVersionInfo<TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
): void {
    const tool = findToolByName(context, toolName);
    const combinations = context.versionCombinations;

    if (!combinations) {
        throw new Error(`No version matrix found for tool: ${tool.name}`);
    }

    const defaultVersion = getToolDefaultVersion(context, tool.name);
    const supportedVersions = getToolSupportedVersions(context, tool.name);

    console.log(`\n🔧 ${tool.name.toUpperCase()} Version Information`);
    console.log('─'.repeat(40));
    console.log(`Default version: ${defaultVersion}`);
    console.log(`Supported versions: ${supportedVersions.join(', ')}`);
    console.log();

    // Display default cache volumes
    if (tool.defaultVolumes && tool.defaultVolumes.length > 0) {
        console.log('📦 Default cache volumes:');
        tool.defaultVolumes.forEach((volume) => {
            const volumeDesc =
                volume.type === 'isolate'
                    ? `${volume.name} → ${volume.containerPath}`
                    : `${volume.hostPath} → ${volume.containerPath}`;
            console.log(`  • ${volumeDesc}`);
        });
        console.log('  💡 Use -v to override or add additional volumes');
        console.log();
    }

    console.log('🔗 Compatible combinations with other tools:');
    for (const [index, combination] of combinations.entries()) {
        if (combination.images[tool.name]) {
            console.log(formatVersionCombination(context, combination, !index));
        }
    }
    console.log();

    console.log('📝 Version resolution priority:');
    console.log('  1. Command line options (--{tool}-version)');
    console.log('  2. Default version');
    console.log();
}
