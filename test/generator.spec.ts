import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { describe, test } from 'node:test';
import { extract_sql } from '../src/generator.ts';

describe(extract_sql.name, () => {
    test('should match valid snapshot', async () => {
        const content = await fs.readFile('test/fixtures/valid.txt', 'utf8');
        const queries = extract_sql(content);

        const lines = queries.map((x) => (x.success ? x.query.sql : x.error));
        const result = lines.join('\n');

        // await fs.writeFile('test/fixtures/valid.sql', result);

        const snapshot = await fs.readFile('test/fixtures/valid.sql', 'utf8');
        assert.strictEqual(result, snapshot);
    });

    test('should match invalid snapshot', async () => {
        const content = await fs.readFile('test/fixtures/invalid.txt', 'utf8');
        const queries = extract_sql(content);

        const lines = queries.map((x) => (x.success ? x.query.sql : x.error));
        const result = lines.join('\n');

        // await fs.writeFile('test/fixtures/invalid.sql', result);

        const snapshot = await fs.readFile('test/fixtures/invalid.sql', 'utf8');
        assert.strictEqual(result, snapshot);
    });
});
