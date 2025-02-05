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
    enums: unknown[];
    composite_types: unknown[];
};

type TableElement = {
    rel: ObjectType;
    columns: Column[];
    comment: string;
};

type Column = {
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
