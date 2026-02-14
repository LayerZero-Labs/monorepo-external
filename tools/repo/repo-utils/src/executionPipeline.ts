import { runWithSpinner } from './cliSpinner';

export interface FlowMeta {
    id: string;
    message: string;
}

export type Step = {
    flowMeta: FlowMeta;
    run: () => Promise<void>;
    concurrent?: boolean;
};

enum LogType {
    INFO = 'info',
    SUCCESS = 'success',
    ERROR = 'error',
}

/**
 * Log a message in light green
 * @param message - The message to log
 */
const _log = (message: string, type: LogType = LogType.INFO) => {
    if (type === LogType.SUCCESS) {
        console.log(`\n${message}`);
        return;
    }

    console.log('\n────────────────────────────────────────────────────────────────');
    // Print the message in light green using ANSI escape codes
    console.log(`\x1b[92m${message}\x1b[0m`);
    console.log('────────────────────────────────────────────────────────────────');
};

/**
 * The pipeline class for running steps in a pipeline.
 */
export class ExecutionPipeline {
    /**
     * The steps to run in the pipeline.
     */
    private steps: Step[] = [];

    /**
     * Add a step to the pipeline.
     *
     * @param name - The name of the step.
     * @param run - The function to run for the step.
     * @param concurrent - Whether the step can run concurrently with other steps.
     * @returns The pipeline instance.
     */
    public add(flowMeta: FlowMeta, run: () => Promise<void>, concurrent = false) {
        this.steps.push({ flowMeta, run, concurrent });
        return this;
    }

    /**
     * Run the pipeline.
     */
    public async run(customSuccessMessage?: string) {
        // Group the steps by whether they can run concurrently.
        const groups = this.steps.reduce<Step[][]>((acc, s, i) => {
            if (i === 0 || !s.concurrent) {
                acc.push([s]);
            } else {
                acc[acc.length - 1].push(s);
            }

            return acc;
        }, []);

        // Run the steps in groups.
        for (const group of groups) {
            const stepLabel = group.map((s) => s.flowMeta.message).join(' + ');

            // Restore the original green boxed log for the step start
            _log(`▶ Running step: ${group.map((s) => s.flowMeta.id).join(' + ')}`);
            await runWithSpinner(stepLabel, async () => {
                await (group.length > 1
                    ? Promise.all(group.map((step) => step.run()))
                    : group[0].run());
            });
        }

        _log(customSuccessMessage || `\n▶ Completed pipeline\n\n`, LogType.SUCCESS);
    }
}
