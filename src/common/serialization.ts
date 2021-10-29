/* Code for JSON parsing MAPs, from SO: https://stackoverflow.com/questions/29085197/how-do-you-json-stringify-an-es6-map */
export function replacer(key: any, value: any) {
    if(value instanceof Map) {
        return {
        dataType: 'Map',
        value: Array.from(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}

export function reviver(key: any, value: any) {
    if(typeof value === 'object' && value !== null) {
        if (value.dataType === 'Map') {
        return new Map(value.value);
        }
    }
    return value;
}
