import Handlebars from 'handlebars';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Direction, GraphData } from './types';

const VISUALIZE_DIR = 'visualized-reports';

export function buildOutputPath(options: {
    rootPath: string;
    depth: number;
    direction: Direction;
    pkg: string;
}): string {
    const { rootPath, depth, direction, pkg } = options;
    const sanitizedPkg = pkg.split('/').pop() || pkg;
    const datetime = new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_');
    const fileName = `${sanitizedPkg}_${datetime}_direction=${direction}_depth=${depth}.html`;
    return path.join(rootPath, VISUALIZE_DIR, fileName);
}

export function openInBrowser(filePath: string): void {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    execFile(cmd, [filePath], (error) => {
        if (error) {
            console.error(`Failed to open browser: ${error.message}`);
        }
    });
}

export async function writeVisualization(opts: {
    graphData: GraphData;
    outputPath: string;
    templateDir: string;
    depth: number;
    direction: Direction;
}): Promise<void> {
    const { graphData, outputPath, templateDir, depth, direction } = opts;
    const { nodes, links, packageName } = graphData;

    const templatePath = path.join(templateDir, 'src', 'graph.handlebars');
    const templateSource = await fs.promises.readFile(templatePath, 'utf8');
    const template = Handlebars.compile(templateSource);

    const nodesData = nodes.map((id) => ({ id }));
    const html = template({
        nodesData: JSON.stringify(nodesData),
        linksData: JSON.stringify(links),
        packageName: packageName || 'Dependency Graph',
        direction,
        depth,
    });

    // Ensure output directory exists
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    await fs.promises.writeFile(outputPath, html);
    console.log(`Graph saved to ${outputPath}`);
}
