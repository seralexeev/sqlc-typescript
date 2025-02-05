import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Generator } from './generator.ts';

const program = new Command();

program.name('sqlc-typescript').description('A CLI tool with watch and generate types for sql tagged template literals.');

program
    .command('watch')
    .argument('<directory>', 'Directory to watch')
    .requiredOption('-c, --config <path>', 'Config file')
    .action((directory, options) => {});

program
    .command('generate')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const configPath = path.resolve(options.config);
        const root = path.dirname(configPath);
        const config = await fs.readFile(configPath, 'utf8').then(JSON.parse);

        await new Generator({ ...config, root }).generate();
    });

program.parse();

// const configPath = path.resolve(values.config);
// const root = path.dirname(configPath);
// const config = await fs.readFile(configPath, 'utf8').then(JSON.parse);
// const include: string[] = typeof config.include === 'string' ? [config.include] : config.include;

// const watcher = chokidar.watch('.', {
//     cwd: root,
//     persistent: true,
//     ignoreInitial: false,
//     usePolling: true,
//     followSymlinks: true,
// });

// watcher
//     .on('all', async (_, filePath) => {
//         if (!include.some((pattern) => minimatch(filePath, pattern))) {
//             return;
//         }

//         console.log(`File changed: ${filePath}`);

//         await generate({ config, root });
//     })
//     .on('error', (error) => console.error(`Watcher error: ${error}`));
