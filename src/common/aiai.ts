export const hexhexAp2Ai = (cell: string, width: number): string => {
    const labels = "abcdefghijklmnopqrstuvwxyz";
    const height = (width * 2) - 1;
    const midrow = Math.floor(height / 2);

    const [left,right] = cell.split("");
    const row = height - labels.indexOf(left) - 1;
    const col = parseInt(right, 10);
    let letter = labels[col - 1];
    if (row > midrow) {
        const delta = row - midrow;
        letter = labels[col - 1 + delta];
    }
    const num = height - row;
    return `${letter}${num}`;
}

export const hexhexAi2Ap = (cell: string, width: number): string => {
    const labels = "abcdefghijklmnopqrstuvwxyz";
    const height = (width * 2) - 1;
    const midrow = Math.floor(height / 2);

    const [left,right] = cell.split("");

    const row = parseInt(right, 10);
    const y = height - row;

    let col = labels.indexOf(left);
    if (y > midrow) {
        const delta = y - midrow;
        col -= delta;
    }

    return labels[height - y - 1] + (col + 1).toString();
}

export const triAp2Ai = (cell: string, width: number): string => {
    const labels = "abcdefghijklmnopqrstuvwxyz";
    const left = cell[0];
    const col = parseInt(cell.substring(1), 10) - 1;
    const row = labels.indexOf(left);
    return `${labels[col]}${width - row}`;
}

export const triAi2Ap = (cell: string, width: number): string => {
    const labels = "abcdefghijklmnopqrstuvwxyz";
    const left = cell[0];
    const row = parseInt(cell.substring(1), 10) - 1;
    const col = labels.indexOf(left);
    return `${labels[col]}${width - row}`;
}
