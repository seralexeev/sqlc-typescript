import { watch } from 'chokidar';
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import ora from 'ora';
import { generate, path_exists } from './generator.ts';
import type { Config } from './types.ts';

const program = new Command();

program.name('sqlc-typescript').description('A CLI tool with watch and generate types for sql queries.');

program
    .command('generate')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const config_path = path.resolve(options.config);
        const { config } = await load_config(config_path);
        const spinner = ora('Generating types...').start();

        try {
            const now = Date.now();
            const result = await generate(config);
            spinner.succeed(`Types generated (${result.queries} queries, ${Date.now() - now}ms)`);
        } catch (error) {
            spinner.fail(`Error: ${(error as any).message}`);
        }
    });

program
    .command('watch')
    .requiredOption('-c, --config <path>', 'Config file', 'sqlc.json')
    .action(async (options) => {
        const config_path = path.resolve(options.config);
        const { config, root } = await load_config(config_path);
        const watch_root = path.resolve(root, glob_root(config.include));
        const watching_text = `Watching \n  - ${watch_root} (${config.include})\n  - ${config.schema}`;

        const watcher = watch([watch_root, config.schema], {
            ignoreInitial: false,
            persistent: true,
            ignorePermissionErrors: true,
            ignored: [config.tmp_dir, config.output],
        });

        const spinner = ora(watching_text).start();

        const debounced_generate = debounce(async () => {
            spinner.start('Generating types...');

            try {
                const now = Date.now();
                const result = await generate(config);
                spinner.succeed(`Types generated (${result.queries} queries, ${Date.now() - now}ms)`);
            } catch (error) {
                spinner.fail(`Error: ${(error as any).message}`);
            } finally {
                spinner.start(watching_text);
            }
        }, 1000);

        watcher.on('all', debounced_generate);
    });

const load_config = async (config_path: string) => {
    const root = path.dirname(config_path);
    const exists = await path_exists(config_path);
    const raw_config = exists ? await fs.readFile(config_path, 'utf8').then(JSON.parse) : {};
    const config = validate_config(raw_config, root);

    return { config, root };
};

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

    final_config.tmp_dir = path.resolve(root, final_config.tmp_dir);
    final_config.output = path.resolve(root, final_config.output);
    final_config.schema = path.resolve(root, final_config.schema);

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
