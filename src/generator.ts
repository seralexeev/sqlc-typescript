import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import prettier from 'prettier';
import util from 'util';
import { generate_types, render_template } from './render.ts';
import type { Config, SqlcResult } from './types.ts';

const execFileAsync = util.promisify(execFile);

export const generate = async (config: Config) => {
    const rm_tmp_dir = await prepare_tmp_dir(config);
    const result_path = path.join(config.root, config.output);

    try {
        const queries = await scan_files(config);
        const exec_result = await exec_sqlc(config);

        if (exec_result.success) {
            const { queries_content, schema_types_content } = generate_types({
                sqlc_result: exec_result.result,
                queries,
                config,
            });

            await render_write({
                queries_content,
                schema_types_content,
                result_path,
                config,
            });

            return { queries: queries.size };
        } else {
            await render_write({
                queries_content: '// Unable to generate queries: ' + exec_result.result,
                result_path,
                config,
            });

            throw new Error(exec_result.result);
        }
    } finally {
        if (config.clear_tmp) {
            await rm_tmp_dir();
        }
    }
};

export const render_write = async ({
    queries_content,
    schema_types_content,
    result_path,
    config,
}: {
    queries_content: string;
    schema_types_content?: string;
    result_path: string;
    config: Pick<Config, 'imports'>;
}) => {
    const file = render_template({
        queries_content,
        schema_types_content,
        imports: config.imports,
    });

    const formatted = await prettier.format(file, {
        parser: 'typescript',
        printWidth: 128,
        tabWidth: 4,
        useTabs: false,
        semi: true,
        singleQuote: true,
        jsxSingleQuote: true,
        trailingComma: 'all',
        bracketSpacing: true,
        bracketSameLine: true,
        arrowParens: 'always',
        endOfLine: 'lf',
    });

    await fs.writeFile(result_path, formatted);
};

export const exec_sqlc = async ({ tmp_dir, root }: Pick<Config, 'tmp_dir' | 'root'>) => {
    try {
        const PLATFORM_MAP: Partial<Record<NodeJS.Platform, string>> = {
            darwin: 'darwin',
            linux: 'linux',
            win32: 'windows',
        };

        const ARCH_MAP: Partial<Record<NodeJS.Architecture, string>> = {
            x64: 'amd64',
            arm64: 'arm64',
        };

        const platform = PLATFORM_MAP[process.platform];
        const arch = ARCH_MAP[process.arch];

        if (!platform || !arch) {
            throw new Error(`Unsupported platform or architecture ${process.platform} ${process.arch}`);
        }

        const binary_name = `sqlc_${platform}_${arch}${process.platform === 'win32' ? '.exe' : ''}`;

        await execFileAsync(path.join(import.meta.dirname, '..', 'bin', 'sqlc', binary_name), ['generate', '-f', 'sqlc.json'], {
            cwd: path.join(root, tmp_dir),
        });

        const result: SqlcResult = await fs
            .readFile(path.join(root, tmp_dir, 'generated', 'codegen_request.json'), 'utf8')
            .then(JSON.parse);

        return { success: true, result } as const;
    } catch (error) {
        if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') {
            const isQueryError = error.stderr.startsWith('# package \nqueries.sql:');
            if (isQueryError) {
                const result = error.stderr.replace(/^# package \nqueries\.sql:\d+:\d+:\s*/, '').trim();
                return { success: false, result } as const;
            }
        }

        throw error;
    }
};

export const prepare_tmp_dir = async ({ root, schema, tmp_dir }: Pick<Config, 'root' | 'schema' | 'tmp_dir'>) => {
    const full_tmp_dir = path.join(root, tmp_dir);

    const exists = await path_exists(full_tmp_dir);
    if (exists) {
        await fs.rm(full_tmp_dir, { recursive: true });
    }

    await fs.mkdir(full_tmp_dir);
    await fs.cp(path.resolve(root, schema), path.join(full_tmp_dir, 'schema.sql'));
    await fs.writeFile(
        path.join(full_tmp_dir, 'sqlc.json'),
        JSON.stringify({
            version: '2',
            sql: [
                {
                    engine: 'postgresql',
                    schema: 'schema.sql',
                    queries: 'queries.sql',
                    gen: { json: { out: 'generated' } },
                },
            ],
        }),
    );

    return () => fs.rm(full_tmp_dir, { recursive: true });
};

export async function scan_files({ root, include, tmp_dir }: Pick<Config, 'root' | 'include' | 'tmp_dir'>) {
    const queries = new Map<string, string>();
    const queries_file = await fs.open(path.join(root, tmp_dir, 'queries.sql'), 'w+');

    try {
        for await (const file of fs.glob(include, { cwd: root })) {
            const content = await fs.readFile(path.join(root, file), 'utf8');

            for (const sql of extract_sql(content)) {
                const { name, content } = render_query(sql);
                await queries_file.appendFile(`${content}\n\n`);
                queries.set(name, sql);
            }
        }
    } finally {
        await queries_file.close();
    }

    return queries;
}

function* extract_sql(content: string) {
    const regex = /\/\*\s*sql\s*\*\/\s*`([^`]+)`/g;

    let match;
    while ((match = regex.exec(content)) != null) {
        const sql = match[1];
        if (sql != null) {
            yield sql;
        }
    }
}

function render_query(sql: string) {
    const hash = crypto.createHash('md5').update(sql.trim()).digest('hex').substring(0, 8);
    const name = `query_${hash}`;

    const header = `-- name: ${name} :execrows`;
    const content = header + '\n' + sql + ';\n';

    return { name, content };
}

export const path_exists = (full_path: string) => {
    return fs
        .access(full_path)
        .then(() => true)
        .catch((error) => {
            if (error.code === 'ENOENT') {
                return false;
            }

            throw error;
        });
};
