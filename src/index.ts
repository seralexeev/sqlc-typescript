import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Generator } from './generator.ts';

const program = new Command();

program.name('sqlc-typescript').description('A CLI tool with watch and generate types for sql tagged template literals.');

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
