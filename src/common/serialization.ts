/* eslint-disable @typescript-eslint/no-explicit-any */

/* Code for JSON parsing MAPs, from SO: https://stackoverflow.com/questions/29085197/how-do-you-json-stringify-an-es6-map */
// Added "Set" code myself

export const replacer = (key: any, value: any) => {
    if (value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else if (value instanceof Set) {
        return {
            dataType: "Set",
            value: Array.from(value)
        };
    } else {
        return value;
    }
}

export const sortingReplacer = (key: any, value: any) => {
    if (value instanceof Map) {
        return {
            dataType: 'Map',
            value: Array.from(value.entries()).sort(), // or with spread: value: [...value]
        };
    } else if (value instanceof Set) {
        return {
            dataType: "Set",
            value: Array.from(value).sort()
        };
    } else {
        return value;
    }
}

export const reviver = (key: any, value: any) => {
    if (typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
            return new Map(value.value);
        } else if (value.dataType === 'Set') {
            return new Set(value.value);
        }
    }
    return value;
}
