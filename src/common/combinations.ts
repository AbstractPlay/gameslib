/**
 * Yields all combinations of size r from the input iterable, allowing elements to be repeated.
 * The order of elements in the combinations is ignored (e.g., [1, 2] is the same as [2, 1]).
 *
 * @param iterable The source elements to combine.
 * @param r The size of each combination.
 */
export function* combinationsWithReplacement<T>(iterable: Iterable<T>, r: number): IterableIterator<T[]> {
    const pool = Array.from(iterable);
    const n = pool.length;

    // If r is 0, the only combination is the empty set.
    if (r === 0) {
        yield [];
        return;
    }

    // If pool is empty or r is negative, no combinations are possible.
    if (n === 0 || r < 0) {
        return;
    }

    const indices = new Array<number>(r).fill(0);
    // map(i => pool[i]) ensures we yield a new array instance each time
    yield indices.map(i => pool[i]);

    while (true) {
        let i = r - 1;
        // Find the rightmost index that hasn't reached the end of the pool
        while (i >= 0 && indices[i] === n - 1) {
            i--;
        }

        // If all indices are at the maximum, we're done
        if (i < 0) {
            return;
        }

        const nextVal = indices[i] + 1;
        for (let j = i; j < r; j++) {
            indices[j] = nextVal;
        }
        yield indices.map(idx => pool[idx]);
    }
}