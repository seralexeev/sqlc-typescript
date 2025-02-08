import { sqlc } from './sqlc';

const client = {
    query: (query: string, params: unknown[]) => Promise.resolve({ rows: [] }),
};

sqlc(/*sql*/ `
    SELECT
        first_name,
        last_name,
        email,
        address_id,
        store_id,
        activebool,
        create_date,
        last_update
    FROM
        customer
    WHERE
        customer_id = @customer_id
`).exec(client, {
    customer_id: 1,
});

sqlc(/*sql*/ `
    SELECT
        film_id,
        title,
        description,
        release_year,
        rental_rate
    FROM
        film
    WHERE
        title LIKE '%' || @film_title || '%';
`).exec(client, {
    film_title: 'foo',
});

sqlc(/*sql*/ `
    SELECT
        r.rental_id,
        r.rental_date,
        f.title AS film_title,
        r.return_date
    FROM
        rental AS r
    JOIN
        inventory AS i ON r.inventory_id = i.inventory_id
    JOIN
        film AS f ON i.film_id = f.film_id
    WHERE
        r.customer_id = @customer_id
    ORDER BY
        r.rental_date DESC;
`).exec(client, {
    customer_id: 1,
});

sqlc(/*sql*/ `
    SELECT
        customer_id,
        COUNT(*) AS rental_count
    FROM
        rental
    GROUP BY
        customer_id
    HAVING
        customer_id = @customer_id
`).exec(client, {
    customer_id: 1,
});

sqlc(/*sql*/ `
    WITH CategoryRevenue AS (
        SELECT
            c.name AS category_name,
            SUM(p.amount) AS total_revenue
        FROM
            category AS c
        JOIN
            film_category AS fc ON c.category_id = fc.category_id
        JOIN
            film AS f ON fc.film_id = f.film_id
        JOIN
            inventory AS i ON f.film_id = i.film_id
        JOIN
            rental AS r ON i.inventory_id = r.inventory_id
        JOIN
            payment AS p ON r.rental_id = p.rental_id
        GROUP BY
            c.name
    )
    SELECT
        category_name,
        total_revenue
    FROM
        CategoryRevenue
    ORDER BY
        total_revenue DESC
    LIMIT 5
`).exec(client);
