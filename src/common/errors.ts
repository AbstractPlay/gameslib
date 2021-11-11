/**
 * Errors intended for the client instead of developers.
 * Because of how Chai works, the message needs to remain an error code,
 * but this error has a `client` field that contains the translated message.
 *
 * @export
 * @class UserFacingError
 * @extends {Error}
 */
export class UserFacingError extends Error {
    public client: string;
    constructor(message: string, translation: string) {
        super(message);
        this.name = "UserFacingError";
        this.client = translation;
    }
}
