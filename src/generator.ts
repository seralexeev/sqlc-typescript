import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import util from 'util';
import { generate_types, render_template } from './render.ts';
import type { Config, SqlcResult, SqlQuery, SqlQueryParseResult } from './types.ts';

const execFileAsync = util.promisify(execFile);

export const generate = async (config: Config) => {
    const rm_tmp_dir = await prepare_tmp_dir(config);

    try {
        const queries = await scan_files(config);
        const exec_result = await exec_sqlc(config);

        if (exec_result.success) {
            const { rendered_queries, schema_types_content } = generate_types({
                sqlc_result: exec_result.result,
                queries,
                config,
            });

            await render_write({
                rendered_queries,
                schema_types_content,
                result_path: config.output,
                config,
            });

            return { queries: queries.size };
        } else {
            await render_write({
                rendered_queries: '// Unable to generate queries: ' + exec_result.result,
                result_path: config.output,
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
    rendered_queries,
    schema_types_content,
    result_path,
    config,
}: {
    rendered_queries: string;
    schema_types_content?: string;
    result_path: string;
    config: Pick<Config, 'imports'>;
}) => {
    const file = render_template({
        rendered_queries,
        schema_types_content,
        imports: config.imports,
    });

    await fs.writeFile(result_path, file);
};

export const exec_sqlc = async ({ tmp_dir }: Pick<Config, 'tmp_dir' | 'root'>) => {
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
            cwd: tmp_dir,
        });

        const result: SqlcResult = await fs
            .readFile(path.join(tmp_dir, 'generated', 'codegen_request.json'), 'utf8')
            .then(JSON.parse);

        return { success: true, result } as const;
    } catch (error) {
        if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') {
            const isQueryError = error.stderr.startsWith('# package \nqueries.sql:');
            if (isQueryError) {
                const result = parse_error(error.stderr);
                if (result?.line != null) {
                    const content = await fs.readFile(path.join(tmp_dir, 'queries.sql'), 'utf8').then((x) => x.split('\n'));
                    let start_line = result?.line;
                    while (start_line > 0 && !content[start_line]?.startsWith('-- name:')) {
                        start_line--;
                    }

                    let end_line = result?.line;
                    while (end_line < content.length && !content[end_line]?.startsWith('-- name:')) {
                        end_line++;
                    }

                    const error_lines: string[] = [''];
                    for (let i = start_line + 1; i < end_line - 1; i++) {
                        const line = content[i];
                        if (line != null) {
                            error_lines.push(line);
                        }

                        if (i === result.line - 1) {
                            error_lines.push(' '.repeat(result.position - 1) + '^');
                            error_lines.push(' '.repeat(result.position - 1) + result.message);
                            error_lines.push('');
                        }
                    }

                    return {
                        success: false,
                        result: `Failed to parse query: ${result.message}\n${error_lines.join('\n')}`,
                    } as const;
                }

                return { success: false, result: result.message } as const;
            }
        }

        throw error;
    }
};

const parse_error = (message: string) => {
    const regex = /queries\.sql:(\d+):(\d+):\s*(.*)/;
    const cleaned_message = message.replace('# package \n', '');
    const match = cleaned_message.match(regex);

    if (!match) {
        return {
            message: cleaned_message,
        };
    }

    const [, line, position, error] = match;
    if (line != null && position != null) {
        return {
            line: parseInt(line),
            position: parseInt(position),
            message: error ?? cleaned_message,
        };
    }

    return { message: cleaned_message };
};

export const prepare_tmp_dir = async ({ schema, tmp_dir }: Pick<Config, 'root' | 'schema' | 'tmp_dir'>) => {
    const exists = await path_exists(tmp_dir);
    if (exists) {
        await fs.rm(tmp_dir, { recursive: true });
    }

    await fs.mkdir(tmp_dir);
    await fs.cp(schema, path.join(tmp_dir, 'schema.sql'));
    await fs.writeFile(
        path.join(tmp_dir, 'sqlc.json'),
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

    return () => fs.rm(tmp_dir, { recursive: true });
};

export async function scan_files({ root, include, tmp_dir }: Pick<Config, 'root' | 'include' | 'tmp_dir'>) {
    const queries = new Map<string, SqlQuery>();
    const queries_file = await fs.open(path.join(tmp_dir, 'queries.sql'), 'w+');

    try {
        for await (const file of fs.glob(include, { cwd: root })) {
            const file_path = path.join(root, file);
            const content = await fs.readFile(file_path, 'utf8');

            for (const result of extract_sql(content)) {
                if (result.success) {
                    const { name, content } = render_query(result.query.normalized_sql);
                    if (!queries.has(name)) {
                        await queries_file.appendFile(`-- ${file}\n`);
                        await queries_file.appendFile(`${content}\n\n`);
                        queries.set(name, result.query);
                    }
                } else {
                    console.error(result.error);
                }
            }
        }
    } finally {
        await queries_file.close();
    }

    return queries;
}

export const extract_sql = (content: string): SqlQueryParseResult[] => {
    const results: SqlQueryParseResult[] = [];

    try {
        const sourceFile = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true);

        function visit(node: ts.Node) {
            if (ts.isCallExpression(node)) {
                const identifier = node.expression;

                // Check if it's a call to 'sqlc'
                if (ts.isIdentifier(identifier) && (identifier.text === 'sqlc' || identifier.text === 'sqln')) {
                    const arg = node.arguments[0];

                    if (!arg) {
                        results.push({
                            success: false,
                            error: `Missing argument in sqln call at position ${node.pos}`,
                        });
                        return;
                    }

                    // Check for template literal interpolation
                    if (ts.isTemplateExpression(arg)) {
                        results.push({
                            success: false,
                            error: `Template literal interpolation is not allowed at position ${arg.pos}`,
                        });
                        return;
                    }

                    // Check argument count
                    if (node.arguments.length > 1) {
                        results.push({
                            success: false,
                            error: `Multiple arguments are not allowed in sqlc call at position ${node.pos}`,
                        });
                        return;
                    }

                    let query: string | undefined;

                    // Handle template literal
                    if (ts.isNoSubstitutionTemplateLiteral(arg)) {
                        query = arg.getText().slice(1, -1); // Remove backticks
                        results.push({
                            success: true,
                            query: {
                                type: identifier.text === 'sqln' ? 'nested' : 'flat',
                                sql: query,
                                normalized_sql: normalize_sql(query),
                            },
                        });
                    }
                    // Handle string literal
                    else if (ts.isStringLiteral(arg)) {
                        query = arg.getText().slice(1, -1); // Remove quotes
                        results.push({
                            success: true,
                            query: {
                                type: identifier.text === 'sqln' ? 'nested' : 'flat',
                                sql: query,
                                normalized_sql: normalize_sql(query),
                            },
                        });
                    } else {
                        results.push({
                            success: false,
                            error: `Invalid argument type in sqlc call at position ${arg.pos}. Expected string literal or template literal.`,
                        });
                    }
                }
            }

            ts.forEachChild(node, visit);
        }

        visit(sourceFile);
    } catch (e) {
        results.push({
            success: false,
            error: `Failed to parse TypeScript code: ${e instanceof Error ? e.message : String(e)}`,
        });
    }

    return results;
};

const normalize_sql = (sql: string) => {
    const lines = sql.split('\n');

    while (lines[0]?.trim() === '') {
        lines.shift();
    }

    while (lines[lines.length - 1]?.trim() === '') {
        lines.pop();
    }

    const [first_line] = lines;
    const padding_length = (first_line?.length ?? 0) - (first_line ?? '').trimStart().length;
    return lines.map((line) => line.slice(padding_length)).join('\n');
};

const render_query = (normalized_sql: string) => {
    const hash = crypto.createHash('md5').update(normalized_sql).digest('hex').substring(0, 8);
    const name = `query_${hash}`;

    const header = `-- name: ${name} :execrows`;
    const content = header + '\n' + normalized_sql + ';\n';

    return { name, content };
};

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
