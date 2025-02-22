export type SqlQuery = { sql: string; normalized_sql: string; type: 'flat' | 'nested' };
export type SqlQueryParseResult = { success: true; query: SqlQuery } | { success: false; error: string };

export type Config = {
    root: string;
    schema: string;
    include: string;
    output: string;
    tmp_dir: string;
    clear_tmp: boolean;
    types: Record<string, string>;
    columns: Record<string, string>;
    imports: string[];
};

export type SqlcResult = {
    settings: Settings;
    catalog: CatalogClass;
    queries: SqlcQuery[];
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

export type SqlcQuery = {
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
