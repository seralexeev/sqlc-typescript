import { sqlc, sqln} from './sqlc.ts';
import { Pool, type PoolClient } from 'pg';
import type { UUID } from './types.ts';

export class CustomerService {
    private pool = new Pool();

    private with_client = async <T>(fn: (client: PoolClient) => Promise<T>) => {
        const client = await this.pool.connect();

        try {
            return await fn(client);
        } finally {
            client.release();
        }
    };

    public get_all = async () => {
        return this.with_client((client) => {
            return sqlc(/* sql */ `
                SELECT
                    customer_id,
                    store_id
                FROM customer
            `).exec(client);
        });
    };

    public get_by_id = async (customer_id: string) => {
        return this.with_client(async (client) => {
            // comment is not necessary, but it's nice to have
            // to have syntax highlighting and formatting
            const [data = null] = await sqln(`
                SELECT
                    c.customer_id AS id,
                    c.first_name,
                    c.last_name,
                    s.manager_staff_id AS "store.manager_staff_id",
                    a.address_id AS "store.address.id",
                    a.address AS "store.address.address",
                    a.address2 AS "store.address.address2"
                FROM customer AS c
                JOIN store AS s ON c.store_id = s.store_id
                JOIN address AS a ON c.address_id = a.address_id
                WHERE customer_id = @customer_id
            `).exec(client, {
                customer_id: customer_id as UUID,
            });

            // Automatically unflattens the result
            // {
            //     id: UUID;
            //     first_name: string;
            //     last_name: string;
            //     store: {
            //         manager_staff_id: number;
            //         address: {
            //             id: number;
            //             address: string;
            //             address2: string | null;
            //         };
            //     };
            // }[]
            
            return data;
        });
    };

    public complex_query = async () => {
        const query = sqlc(/* sql */ `
            WITH customer_spending AS (
                SELECT 
                    c.customer_id,
                    c.first_name,
                    c.last_name,
                    COUNT(r.rental_id) as total_rentals,
                    SUM(p.amount) as total_spent,
                    AVG(p.amount) as avg_payment
                FROM customer c
                JOIN rental r ON c.customer_id = r.customer_id
                JOIN payment p ON r.rental_id = p.rental_id
                GROUP BY c.customer_id, c.first_name, c.last_name
            ),
            customer_categories AS (
                SELECT DISTINCT
                    c.customer_id,
                    STRING_AGG(cat.name, ', ') OVER (PARTITION BY c.customer_id) as favorite_categories
                FROM customer c
                JOIN rental r ON c.customer_id = r.customer_id
                JOIN inventory i ON r.inventory_id = i.inventory_id
                JOIN film_category fc ON i.film_id = fc.film_id
                JOIN category cat ON fc.category_id = cat.category_id
            )
            SELECT 
                cs.*,
                cc.favorite_categories,
                RANK() OVER (ORDER BY cs.total_spent DESC) as spending_rank,
                NTILE(4) OVER (ORDER BY cs.total_rentals) as rental_quartile,
                ROUND(cs.total_spent / SUM(cs.total_spent) OVER () * 100, 2) as percentage_of_total_revenue
            FROM customer_spending cs
            JOIN customer_categories cc ON cs.customer_id = cc.customer_id
            WHERE cs.total_rentals > 5
            ORDER BY spending_rank
        `);

        return this.with_client((client) => query.exec(client));
    };
}
