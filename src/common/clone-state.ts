/**
 * Deep-clone plain game state (Maps, arrays, nested objects).
 * Replaces rfdc for move simulation and clone() helpers during ESM migration.
 */
export function cloneState<T>(value: T): T {
    return structuredClone(value);
}
