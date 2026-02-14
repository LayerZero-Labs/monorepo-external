/**
 * Minimal terminal spinner for long-running actions.
 * Falls back to plain logs when not in a TTY.
 */
export class Spinner {
    private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private intervalMs = 80;
    private timer?: ReturnType<typeof setInterval>;
    private frameIndex = 0;
    private text = '';
    private isTty = !!process.stdout.isTTY;
    private running = false;
    private stdoutWrite: (chunk: any, enc?: any, cb?: any) => any = process.stdout.write.bind(
        process.stdout,
    ) as any;
    private stderrWrite: (chunk: any, enc?: any, cb?: any) => any = process.stderr.write.bind(
        process.stderr,
    ) as any;

    /**
     * Set the writers for the spinner.
     * @param stdoutWriter - The writer for the stdout.
     * @param stderrWriter - The writer for the stderr.
     */
    public setWriters(
        stdoutWriter: (chunk: any, enc?: any, cb?: any) => any,
        stderrWriter: (chunk: any, enc?: any, cb?: any) => any,
    ) {
        this.stdoutWrite = stdoutWriter;
        this.stderrWrite = stderrWriter;
    }

    /**
     * Start the spinner.
     * @param text - The text to display next to the spinner.
     */
    public start(text: string) {
        this.text = text;

        if (!this.isTty) {
            console.log(text);
            return;
        }

        this.stdoutWrite('\u001B[?25l');
        this.timer = setInterval(() => this.render(), this.intervalMs);
        this.running = true;
    }

    /**
     * Update the text to display next to the spinner.
     * @param text - The text to display next to the spinner.
     */
    public update(text: string) {
        this.text = text;
    }

    /**
     * Stop the spinner.
     * @param finalText - The text to display after the spinner.
     */
    public stop(finalText?: string) {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.running = false;

        if (!this.isTty) {
            if (finalText) {
                console.log(finalText);
            }
            return;
        }

        this.stdoutWrite('\r\x1b[2K');

        if (finalText) {
            this.stdoutWrite(finalText + '\n');
        }

        this.stdoutWrite('\u001B[?25h');
    }

    /**
     * Stop the spinner silently.
     */
    public stopSilently() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        this.running = false;
        if (!this.isTty) return;
        this.stdoutWrite('\r\x1b[2K');
        this.stdoutWrite('\u001B[?25h');
    }

    /**
     * Check if the spinner is running.
     * @returns True if the spinner is running, false otherwise.
     */
    public isRunning(): boolean {
        return this.running;
    }

    /**
     * Render the spinner.
     */
    private render() {
        const frame = this.frames[this.frameIndex % this.frames.length];
        this.frameIndex += 1;
        this.stdoutWrite(`\r\x1b[2K${frame} ${this.text}`);
    }

    /**
     * Redraw the current spinner frame without advancing the animation.
     * Useful when other logs temporarily clear the line.
     */
    public redraw() {
        if (!this.isTty || !this.running) return;
        const frame = this.frames[this.frameIndex % this.frames.length];
        this.stdoutWrite(`\r\x1b[2K${frame} ${this.text}`);
    }
}

/**
 * Run a function with a spinner.
 * @param label - The label to display next to the spinner.
 * @param runner - The function to run with the spinner.
 */
export async function runWithSpinner(label: string, runner: () => Promise<void>): Promise<void> {
    const stdoutWrite = process.stdout.write.bind(process.stdout) as any;
    const stderrWrite = process.stderr.write.bind(process.stderr) as any;

    const spinner = new Spinner();
    spinner.setWriters(stdoutWrite, stderrWrite);
    spinner.start(label);

    // Clear the spinner line
    const clearSpinnerLine = () => {
        if (spinner.isRunning()) {
            stdoutWrite('\r\x1b[2K');
        }
    };

    // Patched stdout writer
    const patchedStdout = (chunk: any, enc?: any, cb?: any) => {
        clearSpinnerLine();
        const result = stdoutWrite(chunk, enc, cb);
        spinner.redraw();
        return result;
    };
    const patchedStderr = (chunk: any, enc?: any, cb?: any) => {
        clearSpinnerLine();
        const result = stderrWrite(chunk, enc, cb);
        spinner.redraw();
        return result;
    };

    process.stdout.write = patchedStdout;
    process.stderr.write = patchedStderr;

    try {
        await runner();
    } finally {
        // Restore original writers
        process.stdout.write = stdoutWrite;
        process.stderr.write = stderrWrite;
        if (spinner.isRunning()) {
            spinner.stop();
        }
    }
}
