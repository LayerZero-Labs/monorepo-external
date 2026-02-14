import type { ArgumentConfig } from '@layerzerolabs/ts-command-line-args';
import { parse as commandParse } from '@layerzerolabs/ts-command-line-args';

interface IHelp {
    help?: boolean;
}

const helpArgs = {
    help: {
        type: Boolean,
        optional: true,
        alias: 'h',
        description: 'Prints this usage guide',
    },
};

export const parse = <T extends { [name: string]: any }>(options: {
    args: ArgumentConfig<T>;
    header?: string;
    description?: string;
    partial?: boolean;
    caseInsensitive?: boolean;
}): T & IHelp => {
    // Making sure that every script alway exist on SIGINT and SIGTERM
    ['SIGINT', 'SIGTERM'].forEach((signal: string) => {
        process.on(signal, () => {
            process.exit(0);
        });
    });

    // If comming from VSCode debugger, flatening the args
    // If using Javascript Debug Terminal, they will already be flatened
    if (process.env.VSCODE_INSPECTOR_OPTIONS && process.argv.length === 3) {
        process.argv = [
            process.argv[0],
            process.argv[1],
            ...process.argv[2].split(' ').filter((a) => a),
        ];
    }

    return commandParse<T & IHelp>(
        // @ts-ignore
        {
            ...options.args,
            ...helpArgs,
        },
        {
            // @ts-ignore
            helpArg: 'help',
            headerContentSections: [
                {
                    header: options.header || 'Offchain script',
                    content: options.description || 'Probably awesome script but no description',
                },
            ],
            footerContentSections: [
                {
                    header: '---------------------------------',
                    content: `Copyright: LayerZero Labs Inc.`,
                },
            ],
            partial: (options.partial ?? false) as any,
            caseInsensitive: options.caseInsensitive ?? false,
        },
    );
};
