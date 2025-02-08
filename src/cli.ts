import { watch } from 'chokidar';
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generate } from './generator.ts';
import type { Config } from './types.ts';

const program = new Command();

program.name('sqlc-typescript').description('A CLI tool with watch and generate types for sql queries.');

program
    .command('generate')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const config_path = path.resolve(options.config);
        const root = path.dirname(config_path);
        const config = await fs
            .readFile(config_path, 'utf8')
            .then(JSON.parse)
            .then((config) => validate_config(config, root));

        await generate(config);
    });

program
    .command('watch')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const config_path = path.resolve(options.config);
        const root = path.dirname(config_path);
        const config = await fs
            .readFile(config_path, 'utf8')
            .then(JSON.parse)
            .then((config) => validate_config(config, root));

        const watch_root = path.resolve(root, glob_root(config.include));

        const watcher = watch(watch_root, {
            ignoreInitial: false,
            persistent: true,
            ignorePermissionErrors: true,
            ignored: [path.resolve(root, config.tmp_dir), path.resolve(root, config.output)],
        });

        const debounced_generate = debounce(async () => {
            console.log('🔵 Generating types');
            try {
                const now = Date.now();
                const result = await generate(config);
                console.log(`🟢 Types generated (${result.queries} queries, ${Date.now() - now}ms)`);
            } catch (error) {
                console.log('🔴 Types generation failed', error);
            }
        }, 1000);

        watcher.on('all', () => {
            console.log('🔵 Files changed');
            return debounced_generate();
        });

        console.log(`🟣 Watching directory "${watch_root}"`);
    });

const validate_config = (config: unknown, root: string): Config => {
    if (typeof config !== 'object' || config == null) {
        throw new Error('Invalid config: expected an object');
    }

    const final_config: Config = {
        root,
        schema: 'schema.sql',
        include: 'src/**/*.ts',
        output: 'src/sqlc.ts',
        tmp_dir: '.sqlc',
        clear_tmp: true,
        types: {},
        columns: {},
        imports: [],
    };

    if ('schema' in config && typeof config.schema === 'string') {
        final_config.schema = config.schema;
    }

    if ('include' in config && typeof config.include === 'string') {
        final_config.include = config.include;
    }

    if ('output' in config && typeof config.output === 'string') {
        final_config.output = config.output;
    }

    if ('tmp_dir' in config && typeof config.tmp_dir === 'string') {
        final_config.tmp_dir = config.tmp_dir;
    }

    if ('clear_tmp' in config && typeof config.clear_tmp === 'boolean') {
        final_config.clear_tmp = config.clear_tmp;
    }

    if ('imports' in config && Array.isArray(config.imports)) {
        final_config.imports = config.imports;

        for (const imp of final_config.imports) {
            if (typeof imp !== 'string') {
                throw new Error('Invalid import definition: expected a string');
            }
        }
    }

    if ('columns' in config && typeof config.columns === 'object' && config.columns != null) {
        final_config.columns = Object.fromEntries(
            Object.entries(config.columns).map(([key, value]) => {
                if (typeof value !== 'string') {
                    throw new Error(`Invalid column definition for "${key}": expected a string`);
                }

                return [key, value];
            }),
        );
    }

    if ('types' in config && typeof config.types === 'object' && config.types != null) {
        final_config.types = Object.fromEntries(
            Object.entries(config.types).map(([key, value]) => {
                if (typeof value !== 'string') {
                    throw new Error(`Invalid type definition for "${key}": expected a string`);
                }

                return [key, value];
            }),
        );
    }

    return final_config;
};

const glob_root = (pattern: string) => {
    const parts = pattern.split(/[\\/]/);
    const glob_index = parts.findIndex((part) => /[*?{}[\]]/.test(part));
    return glob_index === -1 ? pattern : path.join(...parts.slice(0, glob_index));
};

const debounce = (func: () => Promise<void>, wait: number) => {
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
};

program.parse();
