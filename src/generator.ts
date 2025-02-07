import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'util';
import { BINARY_NAME } from './platform.ts';
import { DEFAULT_TYPES, type Column, type SqlcResult } from './types.ts';

const execFileAsync = util.promisify(execFile);

type Config = {
    root: string;
    schema: string;
    include: string | string[];
    types: Record<string, string>;
    output: string;
};

export class Generator {
    public config;
    public schemaTypes = new Set<string>();

    public constructor(config: Config) {
        this.config = {
            ...config,
            types: config.types ?? {},
        };
    }

    public async generate() {
        const tmp = await this.prepare();
        const files = await Array.fromAsync(this.readFiles());
        if (files.length === 0) {
            return;
        }

        const queries = new Map<string, string>();
        const queryFile = await fs.open(path.join(tmp, 'queries.sql'), 'w+');

        for (const sql of files) {
            const hash = crypto.createHash('md5').update(sql.trim()).digest('hex').substring(0, 8);
            const name = `query_${hash}`;

            if (queries.has(hash)) {
                continue;
            }

            const header = `-- name: ${name} :execrows`;
            await queryFile.appendFile(`${header}\n${sql};\n`);
            queries.set(name, sql);
        }

        let file = '';
        try {
            await execFileAsync(
                path.join(import.meta.dirname, '..', 'bin', 'sqlc', BINARY_NAME),
                ['generate', '-f', 'sqlc.json'],
                { cwd: tmp },
            );

            const output = await fs.readFile(path.join(tmp, 'generated', 'codegen_request.json'), 'utf8').then(JSON.parse);
            file = render({ content: this.generateTypes(queries, output) });
        } catch (error) {
            if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') {
                const isQueryError = error.stderr.startsWith('# package \nqueries.sql:');
                if (isQueryError) {
                    const message = error.stderr.replace(/^# package \nqueries\.sql:\d+:\d+:\s*/, '').trim();
                    console.error(message);
                }

                file = render({ content: 'const queries = {};' });
            } else {
                throw error;
            }
        }

        await fs.writeFile(path.join(this.config.root, this.config.output), file);
        // await fs.rm(tmp, { recursive: true });
    }

    private async *readFiles() {
        for await (const file of fs.glob(this.config.include, { cwd: this.config.root })) {
            const content = await fs.readFile(path.join(this.config.root, file), 'utf8');
            const regex = /\/\*\s*sql\s*\*\/\s*`([^`]+)`/g;

            let match;
            while ((match = regex.exec(content)) != null) {
                const sql = match[1];
                if (sql == null) {
                    continue;
                }

                yield sql;
            }
        }
    }

    private async prepare() {
        const tmp = path.join(this.config.root, '.sqlc');
        const schema = path.resolve(this.config.root, this.config.schema);

        const exists = await fs
            .access(tmp)
            .then(() => true)
            .catch((error) => {
                if (error.code === 'ENOENT') {
                    return false;
                }

                throw error;
            });

        if (exists) {
            await fs.rm(tmp, { recursive: true });
        }

        await fs.mkdir(tmp);
        await fs.cp(schema, path.join(tmp, 'schema.sql'));
        await fs.writeFile(
            path.join(tmp, 'sqlc.json'),
            JSON.stringify({
                version: '2',
                sql: [
                    { engine: 'postgresql', schema: 'schema.sql', queries: 'queries.sql', gen: { json: { out: 'generated' } } },
                ],
            }),
        );

        return tmp;
    }

    private generateTypes(queries: Map<string, string>, output: SqlcResult) {
        const lines = [];

        for (const schema of output.catalog.schemas) {
            if (schema.composite_types.length === 0 && schema.enums.length === 0) {
                continue;
            }

            if (schema.name !== 'public') {
                lines.push(`namespace ${schema.name} {`);
            }

            const padding = schema.name === 'public' ? '' : '    ';

            for (const e of schema.enums) {
                if (e.comment !== '') {
                    lines.push(padding + `/** ${e.comment} */`);
                }

                lines.push(padding + `export type ${e.name} = ${e.vals.map((v) => `'${v}'`).join(' | ')};`);
                this.schemaTypes.add([schema.name, e.name].join('.'));
            }

            for (const ct of schema.composite_types) {
                if (ct.comment !== '') {
                    lines.push(padding + `/** ${ct.comment} */`);
                }

                lines.push(padding + `export type ${ct.name} = unknown;`);
                this.schemaTypes.add([schema.name, ct.name].join('.'));
            }

            if (schema.name !== 'public') {
                lines.push('}');
            }

            lines.push('');
        }

        lines.push('const queries = {');

        for (const query of output.queries) {
            const original = queries.get(query.name);
            let line = `    [\`${original}\`]: new Query<`;

            if (query.columns.length > 0) {
                line += `{ `;
                line += query.columns.map((column) => `"${column.name}": ${this.objectTypeToTypeScript(column)}`).join('; ');
                line += ` }, `;
            } else {
                line += `never, `;
            }

            if (query.params.length > 0) {
                line += `{ `;
                line += query.params
                    .map((param) => `"${param.column.name}": ${this.objectTypeToTypeScript(param.column)}`)
                    .join('; ');
                line += ` }`;
            } else {
                line += `never`;
            }

            line += `>(\`${query.text.trim()}\`, [${query.params
                .sort((a, b) => a.number - b.number)
                .map((param) => `'${param.column.name}'`)
                .join(', ')}]),`;

            lines.push(line);
        }

        lines.push('};');
        lines.push('');

        return lines.join('\n');
    }

    private objectTypeToTypeScript(column: Column) {
        let type = this.getType(column);

        if (column.is_array) {
            type = `Array<${type}>`;
        }

        if (!column.not_null) {
            type += ' | null';
        }

        return type;
    }

    private getType = (column: Column) => {
        const parts = [column.type.schema, column.type.name.split('.')]
            .flat()
            .filter((x) => x !== '' && x !== 'public' && x !== 'pg_catalog');

        const type = parts.join('.');
        if (this.schemaTypes.has(type)) {
            return [column.type.schema, column.type.name].join('.');
        }

        return this.config.types[type] || DEFAULT_TYPES[type] || 'unknown';
    };
}

const render = ({ content }: { content: string }) =>
    `
type Json = JsonPrimitive | Json[] | { [key: string]: Json };
type JsonPrimitive = string | number | boolean | null;

type QueryClient = {
    query: (
        query: string,
        params: unknown[],
    ) => Promise<{
        rows: Array<Record<string, unknown>>;
    }>;
};

type Override<TSpec, TRow> = Partial<{
    [K in keyof TSpec]: K extends keyof TRow ? TSpec[K] : never;
}>;

type ApplyOverride<TSpec, TRow> = {
    [K in keyof TRow]: K extends keyof TSpec ? TSpec[K] : TRow[K];
};

type ExecFn<TRow, TParam> = [TParam] extends [never]
    ? <TSpec extends Override<TSpec, TRow>>(client: QueryClient) => Promise<Array<ApplyOverride<TSpec, TRow>>>
    : <TSpec extends Override<TSpec, TRow>>(
          client: QueryClient,
          params: TParam & Record<string, unknown>,
      ) => Promise<Array<ApplyOverride<TSpec, TRow>>>;

class Query<TRow, TParam> {
    public query;
    public params;

    public constructor(query: string, params: string[]) {
        this.query = query;
        this.params = params;
    }

    public exec = (async (client, params) => {
        const { rows } = await client.query(
            this.query,
            this.params.map((param) => params[param]),
        );

        return rows;
    }) as ExecFn<TRow, TParam>;
}

type Queries = typeof queries;

${content}

export const sqlc = <T extends keyof Queries>(query: T) => queries[query];
`.trim();
