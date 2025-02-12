type SchemaType = 'value' | 'object' | 'array';

interface SchemaNode {
    type: SchemaType;
    properties?: SchemaProperties;
    original_name?: string;
}

interface SchemaProperties {
    [key: string]: SchemaNode;
}

export interface NestedSchema {
    [key: string]: SchemaNode;
}

type SqlRow = {
    [key: string]: unknown;
    '[]': number;
};

const unflatten_row = (row: SqlRow, schema: NestedSchema): Record<string, unknown> => {
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

const unflatten_sql_results = (rows: SqlRow[]): IdentifiableObject[] => {
    if (rows[0] == null) {
        return [];
    }

    // Step 1: Extract schema from first row
    const schema = extract_nested_schema(Object.keys(rows[0]));

    // Step 2: Unflatten each row according to schema
    const unflattened_rows = rows.map((row) => unflatten_row(row, schema) as IdentifiableObject);

    // Step 3: Merge rows based on root array indicator
    const result: IdentifiableObject[] = [];
    const root_index_map = new Map<number, number>();

    for (const row of unflattened_rows) {
        const root_index = rows[0]['[]'];
        if (typeof root_index !== 'number') {
            throw new Error('Invalid root index');
        }

        const existing_index = root_index_map.get(root_index);
        if (existing_index === undefined) {
            root_index_map.set(root_index, result.length);
            result.push(row);
        } else if (result[existing_index] != null) {
            merge_objects(result[existing_index], row);
        }
    }

    return result;
};

export const extract_nested_schema = (keys: string[]): NestedSchema => {
    const schema: NestedSchema = {};

    for (const key of keys) {
        // Skip the root array indicator as it's used for grouping only
        if (key === '[]') {
            continue;
        }

        let current_obj = schema;
        const parts = key.split('.');

        // Build schema structure by processing each part of the column name
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!part) {
                throw new Error('Invalid schema key at ' + key);
            }

            const is_last = i === parts.length - 1;

            // Handle array notation (e.g., 'orders[]', 'products[]')
            if (part.endsWith('[]')) {
                const array_name = part.slice(0, -2);
                if (!current_obj[array_name]) {
                    current_obj[array_name] = {
                        type: 'array',
                        properties: {},
                    };
                }
                const array_node = current_obj[array_name];
                if (array_node.type !== 'array' || !array_node.properties) {
                    throw new Error('Invalid schema structure at ' + key);
                }
                current_obj = array_node.properties;
            } else {
                // Handle regular fields and nested objects
                if (is_last) {
                    current_obj[part] = {
                        type: 'value',
                        original_name: key,
                    };
                } else {
                    if (!current_obj[part]) {
                        current_obj[part] = {
                            type: 'object',
                            properties: {},
                            original_name: key,
                        };
                    }
                    const obj_node = current_obj[part];
                    if (obj_node.type !== 'object' || !obj_node.properties) {
                        throw new Error('Invalid schema structure at ' + key);
                    }
                    current_obj = obj_node.properties;
                }
            }
        }
    }

    return schema;
};

export { unflatten_sql_results, type IdentifiableObject, type SqlRow };
