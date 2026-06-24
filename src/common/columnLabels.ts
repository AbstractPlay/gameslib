export const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

/**
 * An infinite generator for creating column labels from an initial string of characters.
 * With the English alphabet, you would get a-z, then aa-az-ba-zz, then aaa etc.
 */
export function* generateColumnLabel(labels: string): IterableIterator<string> {
    let n = 0;
    let len = 1;
    const chars = labels.split("");
    while (true) {
        let label = "";
        let mask = n.toString(chars.length);
        while (mask.length < len) {
            mask = "0" + mask;
        }
        for (const char of mask) {
            const val = parseInt(char, chars.length);
            label += chars[val];
        }
        yield label;
        n++;
        const threshold = Math.pow(chars.length, len);
        if (n === threshold) {
            n = 0;
            len++;
        }
    }
}

/** Zero-based index to multi-letter label (0 → a, 25 → z, 26 → aa, …). */
export const indexToColumnLabel = (
    index: number,
    labels: readonly string[] = columnLabels,
): string => {
    const base = labels.length;
    let length = 1;
    if (index >= base) {
        length = Math.floor(Math.log(index) / Math.log(base)) + 1;
    }
    let label = "";
    let counter = index;
    for (let i = length; i > 0; i--) {
        const radix = base ** (i - 1);
        let idx = Math.floor(counter / radix);
        if (i > 1) {
            idx--;
        }
        const char = labels[idx];
        if (char === undefined) {
            throw new Error(`Could not find a character at index ${idx}`);
        }
        label += char;
        counter = counter % radix;
    }
    return label;
};

/** Multi-letter label to zero-based index. */
export const columnLabelToIndex = (
    label: string,
    labels: readonly string[] = columnLabels,
): number => {
    const reversed = [...label.split("").reverse()];
    let index = 0;
    for (let exp = 0; exp < reversed.length; exp++) {
        const idx = labels.indexOf(reversed[exp]);
        if (idx < 0) {
            throw new Error(`The column label is invalid: ${reversed[exp]}`);
        }
        if (exp > 0) {
            index += (idx + 1) * (labels.length ** exp);
        } else {
            index += idx * (labels.length ** exp);
        }
    }
    return index;
};
