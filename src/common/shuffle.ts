
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const shuffle = (lst: Array<any>): Array<any> => {
    const working = [...lst];
    let remaining = working.length;

    // While there remain elements to shuffle…
    while (remaining) {

        // Pick a remaining element…
        const randomIdx = Math.floor(Math.random() * remaining--);

        // And swap it with the current element.
        const t = working[remaining];
        working[remaining] = working[randomIdx];
        working[randomIdx] = t;
    }

    return working;
}