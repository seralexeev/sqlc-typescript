import type { Column, Config, SqlcQuery, SqlcResult, SqlQuery } from './types.ts';
import { extract_nested_schema, type NestedSchema } from './unflatten.ts';

export const generate_types = ({
    sqlc_result,
    queries,
    config,
}: {
    queries: Map<string, SqlQuery>;
    sqlc_result: SqlcResult;
    config: Pick<Config, 'types' | 'columns'>;
}) => {
    const { schema_types, schema_types_content } = get_schema_types(sqlc_result);
    const lines: string[] = [];

    for (const query of sqlc_result.queries) {
        const original = queries.get(query.name);
        if (original == null) {
            throw new Error(`Query "\${query.name}" not found in the original queries`);
        }

        const exec = generate_query({ query, original, config, schema_types });
        lines.push(exec);
    }

    return {
        rendered_queries: lines.join('\n'),
        schema_types_content,
    };
};

export const generate_query = ({
    original,
    query,
    config,
    schema_types,
}: {
    query: SqlcQuery;
    original: SqlQuery;
    config: Pick<Config, 'types' | 'columns'>;
    schema_types: Set<string>;
}) => {
    if (original == null) {
        throw new Error(`Query "${query.name}" not found in the original queries`);
    }

    let exec = `    [${JSON.stringify(original.sql)}]: {\n`;
    const args = ['client: QueryClient'];
    if (query.params.length > 0) {
        const params = query.params.map((param) => {
            return `"${param.column.name}": ${column_to_tstype({ column: param.column, config, schema_types })}`;
        });

        args.push(`params: { ${params.join('; ')} }`);
    }

    exec += `        exec: async`;

    if (query.columns.length > 0) {
        exec += `<TOverride extends Partial<{ ${query.columns
            .map((column) => `"${column.name}": unknown`)
            .join('; ')} }> = {}>`;
    }

    exec += `(${args.join(', ')}) => {\n`;

    let result;

    const nested_schema = original.type === 'nested' ? extract_nested_schema(query.columns.map((c) => c.name)) : null;

    if (query.columns.length > 0) {
        exec += `            type Row = { ${query.columns
            .map((column) => `"${column.name}": ${column_to_tstype({ column, config, schema_types })}`)
            .join('; ')} };\n`;

        result = `{ `;

        if (nested_schema == null) {
            result += query.columns.map((column) => `"${column.name}": Apply<Row, '${column.name}', TOverride>`).join('; ');
        } else {
            result += render_nested_schema({
                nested_schema,
                columns: query.columns,
            });
        }

        result += ` }`;

        result = `Array<${result}>`;
    } else {
        result = 'never[]';
    }

    exec += `            const { rows } = await client.query(${JSON.stringify(query.text)}`;
    if (query.params.length > 0) {
        exec += `, ([${query.params
            .map((param) => `"${param.column.name}"`)
            .join(', ')}] as const).map((param) => params[param])`;
    }

    exec += `);\n`;

    if (nested_schema != null) {
        exec += `            return unflatten_sql_results(rows, ${JSON.stringify(nested_schema)}) as unknown as ${result};\n`;
    } else {
        exec += `            return rows as unknown as ${result};\n`;
    }

    exec += `        },\n`;
    exec += `        type: '${original.type}',\n`;
    exec += `    },`;

    return exec;
};

const render_nested_schema = ({ nested_schema, columns }: { nested_schema: NestedSchema; columns: Column[] }) => {
    const result: string[] = Object.entries(nested_schema).map(([key, value]) => {
        if (value.type === 'value' && value.original_name != null) {
            const column = columns.find((c) => c.name === value.original_name);
            if (column == null) {
                throw new Error(`Column "${value.original_name}" not found in the query`);
            }

            return `${key}: Apply<Row, '${column.name}', TOverride>`;
        }

        if (value.properties == null) {
            throw new Error(`Invalid schema structure at ${key}`);
        }

        if (value.type === 'array') {
            return `${key}: Array<${render_nested_schema({ nested_schema: value.properties, columns })}>`;
        }

        return `${key}: { ${render_nested_schema({ nested_schema: value.properties, columns })} }`;
    });

    return result.join(';');
};

export const get_schema_types = (output: SqlcResult) => {
    const lines: string[] = [];
    const schema_types = new Set<string>();

    for (const schema of output.catalog.schemas) {
        if (schema.composite_types.length === 0 && schema.enums.length === 0) {
            continue;
        }

        if (schema.name !== 'public') {
            lines.push(`declare namespace ${schema.name} {`);
        }

        for (const e of schema.enums) {
            if (e.comment !== '') {
                lines.push(`/** ${e.comment} */`);
            }

            lines.push(`export type ${e.name} = ${e.vals.map((v) => `'${v}'`).join(' | ')};`);
            schema_types.add([schema.name, e.name].join('.'));
        }

        for (const ct of schema.composite_types) {
            if (ct.comment !== '') {
                lines.push(`/** ${ct.comment} */`);
            }

            lines.push(`export type ${ct.name} = unknown;`);
            schema_types.add([schema.name, ct.name].join('.'));
        }

        if (schema.name !== 'public') {
            lines.push('}');
        }

        lines.push('');
    }

    return { schema_types, schema_types_content: lines.join('\n') };
};

const column_to_tstype = ({
    column,
    schema_types,
    config,
}: {
    column: Column;
    schema_types: Set<string>;
    config: Pick<Config, 'types' | 'columns'>;
}) => {
    const { type } = get_column_type({ config, column, schema_types });
    let final_type = type;

    if (column.is_array || column.is_sqlc_slice) {
        final_type = `Array<${type}>`;
    }

    if (!column.not_null) {
        final_type += ' | null';
    }

    return final_type;
};

const get_column_type = ({
    column,
    schema_types,
    config,
}: {
    column: Column;
    schema_types: Set<string>;
    config: Pick<Config, 'types' | 'columns'>;
}) => {
    const source = [
        ...[column.table?.schema, ...(column.table?.name.split('.') ?? [])].filter(
            (x) => x != null && x !== '' && x !== 'public' && x !== 'pg_catalog',
        ),
        column.original_name,
    ].join('.');

    const parts = [column.type.schema, column.type.name.split('.')]
        .flat()
        .filter((x) => x != null && x !== '' && x !== 'public' && x !== 'pg_catalog');

    const db_type = parts.join('.');

    const final_type = (() => {
        if (config.columns[source]) {
            return config.columns[source];
        }

        if (schema_types.has(db_type)) {
            return [column.type.schema, column.type.name].join('.');
        }

        return DEFAULT_TYPES[db_type] || config.types[db_type] || DEFAULT_TYPES[db_type] || 'unknown';
    })();

    return { type: final_type, db_type, source };
};

export const render_template = ({
    rendered_queries,
    schema_types_content,
    header = '// This file was generated by sqlc-typescript\n// Do not modify this file by hand\n',
    imports,
}: {
    rendered_queries: string;
    schema_types_content?: string;
    header?: string;
    imports: string[];
}) => /* ts */ `
${header}

${imports.map((x) => (x.trim().endsWith(';') ? x : x + ';')).join('\n')}

type Json = JsonPrimitive | Json[] | { [key: string]: Json };
type JsonPrimitive = string | number | boolean | null;

type QueryClient = {
    query: (
        query: string,
        params?: unknown[],
    ) => Promise<{
        rows: Array<Record<string, unknown>>;
    }>;
};

type Apply<T, K extends keyof T, TOverride> = K extends keyof TOverride ? TOverride[K] : T[K];

type Queries = typeof queries;

const queries = {
${rendered_queries || '    // no queries found'}
};

${schema_types_content || '// no types found'}

type SchemaNode = {
    type: 'value' | 'object' | 'array';
    properties?: Record<string, SchemaNode>;
    original_name?: string;
};

type NestedSchema = Record<string, SchemaNode>;

const unflatten_row = (row: any, schema: NestedSchema) => {
    // Recursive helper function to build nested objects
    const build_object = (schema: NestedSchema, prefix = ''): Record<string, unknown> => {
        const result: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(schema)) {
            const full_key = prefix ? prefix + '.' + key : key;

            // Handle different types from schema
            if (value.type === 'value') {
                // Direct value assignment for regular fields
                result[key] = row[full_key];
            } else if (value.type === 'object' && value.properties) {
                // Recursive object building for nested structures
                result[key] = build_object(value.properties, full_key);
            } else if (value.type === 'array' && value.properties) {
                // Handle array items - create empty array if null, otherwise build object
                const array_index = row[full_key + '[]'];
                if (array_index === null) {
                    result[key] = [];
                } else {
                    result[key] = [build_object(value.properties, full_key + '[]')];
                }
            }
        }

        return result;
    };

    return build_object(schema);
};

interface IdentifiableObject {
    id?: unknown;
    [key: string]: unknown;
}

const merge_objects = (target: IdentifiableObject, source: IdentifiableObject): IdentifiableObject => {
    for (const [key, value] of Object.entries(source)) {
        if (Array.isArray(value)) {
            // Initialize array if doesn't exist
            const target_array = target[key];
            if (!target_array) {
                target[key] = [];
            } else if (!Array.isArray(target_array)) {
                throw new Error('Expected array at key ' + key);
            }

            // Merge array items if not empty
            if (value.length > 0) {
                const first_value = value[0] as IdentifiableObject;
                const target_typed = target[key] as IdentifiableObject[];

                const existing_item = target_typed.find((item) => item.id === first_value.id);

                if (existing_item) {
                    // Merge into existing item if found
                    merge_objects(existing_item, first_value);
                } else {
                    // Add new items if not found
                    target_typed.push(...(value as IdentifiableObject[]));
                }
            }
        } else if (typeof value === 'object' && value !== null) {
            // Handle nested objects recursively
            if (!target[key]) {
                target[key] = {};
            }
            const target_obj = target[key];
            if (typeof target_obj !== 'object' || target_obj === null) {
                throw new Error('Expected object at key ' + key);
            }
            merge_objects(target_obj as IdentifiableObject, value as IdentifiableObject);
        } else {
            // Direct assignment for primitive values
            target[key] = value;
        }
    }
    return target;
};

const unflatten_sql_results = (rows: any[], schema: NestedSchema): IdentifiableObject[] => {
    if (rows.length === 0) {
        return [];
    }

    // Step 2: Unflatten each row according to schema
    const unflattened_rows = rows.map((row) => unflatten_row(row, schema) as IdentifiableObject);

    // Step 3: Merge rows based on root array indicator
    const result: IdentifiableObject[] = [];
    const root_id_map = new Map<unknown, number>();

    for (const [index, row] of unflattened_rows.entries()) {
        const root_key = rows[index]?.['[]'];
        if (root_key == null) {
            throw new Error('Invalid root key');
        }

        const existing_index = root_id_map.get(root_key);
        if (existing_index == null) {
            root_id_map.set(root_key, result.length);
            result.push(row);
        } else if (result[existing_index] != null) {
            merge_objects(result[existing_index], row);
        }
    }

    return result;
};

export const sqlc = <T extends keyof Queries>(query: T) => queries[query];
export const sqln = <T extends keyof { [K in keyof Queries]: Queries[K]['type'] extends 'nested' ? K : never; }>(query: T) => queries[query];
`;

export const DEFAULT_TYPES: Record<string, string> = {
    // Text types
    text: 'string',
    varchar: 'string',
    char: 'string',
    citext: 'string',
    name: 'string',

    // Numeric types
    int2: 'number',
    int4: 'number',
    int8: 'number',
    smallint: 'number',
    integer: 'number',
    bigint: 'number',
    decimal: 'number',
    numeric: 'number',
    real: 'number',
    float4: 'number',
    float8: 'number',
    double: 'number',
    money: 'number',

    // Boolean type
    bool: 'boolean',
    boolean: 'boolean',

    // Date/Time types
    date: 'Date',
    timestamp: 'Date',
    timestamptz: 'Date',
    time: 'string',
    timetz: 'string',
    interval: 'string',

    // JSON types
    json: 'Json',
    jsonb: 'Json',

    // UUID
    uuid: 'string',

    // Network address types
    inet: 'string',
    cidr: 'string',
    macaddr: 'string',
    macaddr8: 'string',

    // Geometric types
    point: 'string',
    line: 'string',
    lseg: 'string',
    box: 'string',
    path: 'string',
    polygon: 'string',
    circle: 'string',

    // Binary data
    bytea: 'Buffer',

    // Arrays
    _text: 'string[]',
    _varchar: 'string[]',
    _int2: 'number[]',
    _int4: 'number[]',
    _int8: 'number[]',
    _float4: 'number[]',
    _float8: 'number[]',
    _bool: 'boolean[]',
    _date: 'Date[]',
    _timestamp: 'Date[]',
    _timestamptz: 'Date[]',
    _json: 'unknown[]',
    _jsonb: 'unknown[]',
    _uuid: 'string[]',

    // Other common types
    bit: 'string',
    varbit: 'string',
    tsvector: 'string',
    tsquery: 'string',
    xml: 'string',
    enum: 'string',
    oid: 'number',
};
