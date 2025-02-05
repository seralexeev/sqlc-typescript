import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'util';
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

    public constructor(config: Config) {
        this.config = {
            ...config,
            types: config.types ?? {},
        };
    }

    public async generate() {
        const tmp = await this.prepare();
        const files = await Array.fromAsync(this.readFiles());
        const queries = new Map<string, string>();
        const queryFile = await fs.open(path.join(tmp, 'queries.sql'), 'w+');

        for (const sql of files.flat()) {
            const hash = crypto.createHash('md5').update(sql.trim()).digest('hex').substring(0, 8);
            const name = `query_${hash}`;

            if (queries.has(hash)) {
                continue;
            }

            const header = `-- name: ${name} :execrows`;
            await queryFile.appendFile(`${header}\n${sql};\n`);
            queries.set(name, sql);
        }

        await execFileAsync('/Users/sergeyalekseev/projects/sqlc-typescript/bin/sqlc', ['generate', '-f', 'sqlc.json'], {
            cwd: tmp,
        });

        const output = await fs.readFile(path.join(tmp, 'generated', 'codegen_request.json'), 'utf8').then(JSON.parse);
        const result = this.generateTypes(queries, output);

        await fs.writeFile(path.join(this.config.root, this.config.output), result);
        await fs.rm(tmp, { recursive: true });
    }

    private async *readFiles() {
        for await (const file of fs.glob(this.config.include, { cwd: this.config.root })) {
            const content = await fs.readFile(path.join(this.config.root, file), 'utf8');
            const queries: string[] = [];
            const regex = /\/\*\s*sql\s*\*\/\s*`([^`]+)`/g;

            let match;
            while ((match = regex.exec(content)) != null) {
                console.log(match);
                const sql = match[1];
                if (sql == null) {
                    continue;
                }

                queries.push(sql);
            }

            yield queries;
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
        const lines = [
            `class Query<TRow, TParam> {
    public query;
    public params;

    public constructor(query: string, params: string[]) {
        this.query = query;
        this.params = params;
    }

    public exec = async (
        client: { query: (query: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
        params: TParam,
    ) => {
        const { rows } = await client.query(
            this.query,
            this.params.map((param) => params[param]),
        );

        return rows as TRow[];
    };
}
type Queries = typeof queries;`,
            '',
            'const queries = {',
        ];

        for (const query of output.queries) {
            const original = queries.get(query.name);
            let line = `    [\`${original}\`]: new Query<`;

            if (query.columns.length > 0) {
                line += `{ `;
                line += query.columns.map((column) => `${column.name}: ${this.objectTypeToTypeScript(column)}`).join('; ');
                line += ` }, `;
            } else {
                line += `never, `;
            }

            if (query.params.length > 0) {
                line += `{ `;
                line += query.params
                    .map((param) => `${param.column.name}: ${this.objectTypeToTypeScript(param.column)}`)
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
        const type = [column.type.schema, column.type.name]
            .filter((x) => x !== '' && x !== 'public' && x !== 'pg_catalog')
            .join('.');

        return this.config.types[type] || this.DEFAULT_TYPES[type] || 'unknown';
    };

    private DEFAULT_TYPES: Record<string, string> = {
        uuid: 'string',
        text: 'string',
        timestampt: 'Date',
        timestamptz: 'Date',
    };
}
