class Query<TRow, TParam> {
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
type Queries = typeof queries;

const queries = {
    [`
            SELECT
                id,
                name
            FROM users
            WHERE id = @user_id
        `]: new Query<{ id: string; name: string }, { user_id: string }>(`SELECT
                id,
                name
            FROM users
            WHERE id = $1`, ['user_id']),
};

export const sqlc = <T extends keyof Queries>(query: T) => queries[query];