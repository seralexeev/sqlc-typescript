import { sqlc } from './types';

export class UserController {
    public async getUser() {
        const data = await sqlc(/*sql*/ `
            SELECT
                id,
                name
            FROM users
            WHERE id = @user_id
        `).exec(null!, {
            user_id: '1',
        });

        return data;
    }
}
