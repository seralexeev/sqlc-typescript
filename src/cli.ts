import { watch } from 'chokidar';
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Generator } from './generator.ts';

const program = new Command();

program.name('sqlc-typescript').description('A CLI tool with watch and generate types for sql queries.');

program
    .command('generate')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const config_path = path.resolve(options.config);
        const root = path.dirname(config_path);
        const config = await fs.readFile(config_path, 'utf8').then(JSON.parse);

        await new Generator({ ...config, root }).generate();
    });

program
    .command('watch')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const config_path = path.resolve(options.config);
        const root = path.dirname(config_path);
        const config = await fs.readFile(config_path, 'utf8').then(JSON.parse);
        const watch_root = path.resolve(root, glob_root(config.include));

        const watcher = watch(watch_root, {
            ignoreInitial: false,
            persistent: true,
            ignorePermissionErrors: true,
        });

        const generate = debounce(async () => {
            console.log('🔵 Generating types');
            try {
                const now = Date.now();
                const result = await new Generator({ ...config, root }).generate();
                console.log(`🟢 Types generated (${result.queries} queries, ${Date.now() - now}ms)`);
            } catch (error) {
                console.log('🔴 Types generation failed', error);
            }
        }, 1000);

        watcher.on('all', () => {
            console.log('🔵 Files changed');
            return generate();
        });

        console.log(`🟣 Watching directory "${watch_root}"`);
    });

function glob_root(pattern: string) {
    const parts = pattern.split(/[\\/]/);
    const globIndex = parts.findIndex((part) => /[*?{}[\]]/.test(part));
    return globIndex === -1 ? pattern : path.join(...parts.slice(0, globIndex));
}

function debounce(func: () => Promise<void>, wait: number) {
    let timeout: NodeJS.Timeout;
    let promise: Promise<void> | null = null;
    let pending = false;

    const wrapped = () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            if (promise) {
                pending = true;
                return;
            }

            promise = func().finally(() => {
                if (pending) {
                    pending = false;
                    return wrapped();
                }

                promise = null;
            });
        }, wait);
    };

    return wrapped;
}

program.parse();
