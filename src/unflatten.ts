type SchemaNode = {
    type: 'value' | 'object' | 'array';
    properties?: Record<string, SchemaNode>;
    original_name?: string;
};

export type NestedSchema = Record<string, SchemaNode>;

export const extract_nested_schema = (keys: string[]): NestedSchema => {
    const schema: NestedSchema = {};

    const root_key = keys.find((key) => key === '[]');
    if (!root_key) {
        throw new Error('Root key not found');
    }

    for (const key of keys) {
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
