/**
 * Format a plain JSON tree as a TypeScript object literal (string values only at leaves).
 * @param {unknown} value
 * @param {number} [indent]
 * @returns {string}
 */
export function formatPlainObjectAsTs(value, indent = 0) {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Unsupported value in gameApresultsEn: ${String(value)}`);
    }
    const pad = " ".repeat(indent);
    const innerPad = " ".repeat(indent + 4);
    const lines = [];
    for (const [key, child] of Object.entries(value)) {
        const keyText = formatObjectKey(key);
        if (typeof child === "string") {
            lines.push(`${innerPad}${keyText}: ${JSON.stringify(child)},`);
        } else if (child && typeof child === "object" && !Array.isArray(child)) {
            lines.push(`${innerPad}${keyText}: ${formatPlainObjectAsTs(child, indent + 4)},`);
        } else {
            throw new Error(`Unsupported nested value at ${key}`);
        }
    }
    if (lines.length === 0) {
        return "{}";
    }
    return `{\n${lines.join("\n")}\n${pad}}`;
}

/**
 * @param {string} key
 */
function formatObjectKey(key) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return key;
    }
    return JSON.stringify(key);
}
