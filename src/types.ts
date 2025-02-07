export type SqlcResult = {
    settings: Settings;
    catalog: CatalogClass;
    queries: Query[];
    sqlc_version: string;
    plugin_options: string;
    global_options: string;
};

type CatalogClass = {
    comment: string;
    default_schema: string;
    name: string;
    schemas: Schema[];
};

type Schema = {
    comment: string;
    name: string;
    tables: TableElement[];
    enums: Enum[];
    composite_types: CompositeType[];
};

type CompositeType = {
    name: string;
    comment: string;
};

type Enum = {
    name: string;
    vals: string[];
    comment: string;
};

type TableElement = {
    rel: ObjectType;
    columns: Column[];
    comment: string;
};

export type Column = {
    name: string;
    not_null: boolean;
    is_array: boolean;
    comment: string;
    length: number;
    is_named_param: boolean;
    is_func_call: boolean;
    scope: string;
    table: ObjectType;
    table_alias: string;
    type: ObjectType;
    is_sqlc_slice: boolean;
    embed_table: null;
    original_name: string;
    unsigned: boolean;
    array_dims: number;
};

type ObjectType = {
    catalog: string;
    schema: string;
    name: string;
};

type Query = {
    text: string;
    name: string;
    cmd: string;
    columns: Column[];
    params: Param[];
    comments: unknown[];
    filename: string;
    insert_into_table: null;
};

type Param = {
    number: number;
    column: Column;
};

type Settings = {
    version: string;
    engine: string;
    schema: string[];
    queries: string[];
    codegen: Codegen;
};

type Codegen = {
    out: string;
    plugin: string;
    options: string;
    env: unknown[];
    process: unknown;
    wasm: unknown;
};

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
    '_text': 'string[]',
    '_varchar': 'string[]',
    '_int2': 'number[]',
    '_int4': 'number[]',
    '_int8': 'number[]',
    '_float4': 'number[]',
    '_float8': 'number[]',
    '_bool': 'boolean[]',
    '_date': 'Date[]',
    '_timestamp': 'Date[]',
    '_timestamptz': 'Date[]',
    '_json': 'unknown[]',
    '_jsonb': 'unknown[]',
    '_uuid': 'string[]',

    // Other common types
    bit: 'string',
    varbit: 'string',
    tsvector: 'string',
    tsquery: 'string',
    xml: 'string',
    enum: 'string',
    oid: 'number'
};
