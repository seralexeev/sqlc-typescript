import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'util';
import { BINARY_NAME } from './platform.ts';
import type { Column, SqlcResult } from './types.ts';

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

        await execFileAsync(path.join(import.meta.dirname, '..', 'bin', 'sqlc', BINARY_NAME), ['generate', '-f', 'sqlc.json'], {
            cwd: tmp,
        });

        const output = await fs.readFile(path.join(tmp, 'generated', 'codegen_request.json'), 'utf8').then(JSON.parse);
        const result = this.generateTypes(queries, output);

        await fs.writeFile(path.join(this.config.root, this.config.output), result);
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
        const lines = [template, ''];

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
        lines.push('export const sqlc = <T extends keyof Queries>(query: T) => queries[query];');

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

        return this.config.types[type] || this.DEFAULT_TYPES[type] || 'unknown';
    };

    private DEFAULT_TYPES: Record<string, string> = {
        uuid: 'string',
        text: 'string',
        citext: 'string',
        timestampt: 'Date',
        timestamptz: 'Date',
        json: 'Json',
        jsonb: 'Json',
        int2: 'number',
        int4: 'number',
        int8: 'number',
        float4: 'number',
        float8: 'number',
        numeric: 'number',
        bool: 'boolean',
    };
}

const template = `
type Json = JsonPrimitive | Json[] | { [key: string]: Json };
type JsonPrimitive = string | number | boolean | null;

type GetPrefix<K extends string> = K extends \`\${infer T}.\${string}\` ? T : K;
type RemovePrefix<K extends string, P extends string> = K extends \`\${P}.\${infer R}\` ? R : never;

type Nest<T> = Simplify<{
    [P in GetPrefix<keyof T & string>]: P extends keyof T
        ? T[P]
        : Nest<{ [K in keyof T as RemovePrefix<K & string, P>]: K & string extends \`\${P}.\${string}\` ? T[K] : never }>;
}>;

type SimplifyArray<T> = T extends Array<infer U> ? Array<Simplify<U>> : T;
type SimplifyTuple<T> = T extends [...infer Elements] ? { [K in keyof Elements]: Simplify<Elements[K]> } : T;
type SimplifyObject<T> = T extends object ? { [K in keyof T]: Simplify<T[K]> } : T;

export type Simplify<T> = T extends Function
    ? T
    : T extends readonly any[]
      ? SimplifyTuple<T>
      : T extends Array<any>
        ? SimplifyArray<T>
        : T extends object
          ? SimplifyObject<T> & {}
          : T;

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
    ? <TSpec extends Override<TSpec, TRow>>(client: QueryClient) => Promise<Array<Simplify<ApplyOverride<TSpec, TRow>>>>
    : <TSpec extends Override<TSpec, TRow>>(
          client: QueryClient,
          params: TParam & Record<string, unknown>,
      ) => Promise<Array<Simplify<ApplyOverride<TSpec, TRow>>>>;

type ExecNestFn<TRow, TParam> = TParam extends never
    ? <TSpec extends Override<TSpec, TRow>>(client: QueryClient) => Promise<Array<Simplify<Nest<ApplyOverride<TSpec, TRow>>>>>
    : <TSpec extends Override<TSpec, TRow>>(
          client: QueryClient,
          params: TParam & Record<string, unknown>,
      ) => Promise<Array<Simplify<Nest<ApplyOverride<TSpec, TRow>>>>>;

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

    public exec_nest = (async (client, params) => {
        const { rows } = await client.query(
            this.query,
            this.params.map((param) => params[param]),
        );

        return rows.map(nest);
    }) as ExecNestFn<TRow, TParam>;
}

const nest = <T extends Record<string, unknown>>(obj: T) => {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
        const parts = key.split('.');
        let current = result;

        for (const part of parts.slice(0, -1)) {
            if (!(part in current)) {
                current[part] = {};
            }

            current = current[part] as Record<string, unknown>;
        }

        const lastPart = parts[parts.length - 1];
        if (lastPart != null) {
            current[lastPart] = value;
        }
    }

    return result as Nest<T>;
};

type Queries = typeof queries;
`.trim();
