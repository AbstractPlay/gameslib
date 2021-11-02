export function shuffle(lst: Array<any>): Array<any> {
    let remaining = lst.length;

    // While there remain elements to shuffle…
    while (remaining) {

        // Pick a remaining element…
        const randomIdx = Math.floor(Math.random() * remaining--);

        // And swap it with the current element.
        const t = lst[remaining];
        lst[remaining] = lst[randomIdx];
        lst[randomIdx] = t;
    }

    return [...lst];
}