// Modifed from https://github.com/ghwilson4456/Weird-Name-Generator-jQuery-Plugin

type Sound = "hard"|"soft"|"random";

export const wng = (minSize = 3, maxSize = 5, sound: Sound = "random") => {
    const size = randRange(minSize, maxSize);

    const vowels = ['a','e','i','o','u','y'];
    const consonants = ['b','c','d','f','g','h','j','k','l','m','n','p','q','r','s','t','v','w','z'];

    const vowelCombos = ['a','ai','ae','e','ea','ee','ey','i','ia','ie','o','oo','ou','u','y','ye'];

    const vowelsStart = ['a','e','i','o','u'];
    const consonantsHardStart = ['B','Bl','Br','Chr','Cr','D','Dr','G','Gr','K','Kr','P','Pr','Sp','St','T','Tr'];
    const consonantsSoftStart = ['C','Ch','F','H','J','L','M','N','Ph','Qu','R','S','Sh','Sm','Sn','Th','V','W','X','Y','Z'];

    const consonantsHardMid = consonantsHardStart.slice(0).concat(['hm','mbl','rb','rbl']);
    const consonantsSoftMid = consonantsSoftStart.slice(0).concat(['sm','sn','sr']);

    const consonantsHardEnd = ['b','c','ck','d','g','k','nd','p','rt','sp','st','t'];
    const consonantsSoftEnd = ['f','h','j','l','m','n','r','rs','s','th','v','w','x','y','z'];

    let isConst = true;
    let isHard = true;

    if (sound === "random") {
        isConst = flipCoin();
        isHard = flipCoin();
    } else if (sound === "soft") {
        isHard = false;
        isConst = false;
    }

    const weirdName: string[] = [];

    let part = "";

    if (isConst) {
        if (isHard) {
            weirdName.push(validCombo(weirdName, consonantsHardStart));
        } else {
            weirdName.push(validCombo(weirdName, consonantsSoftStart));
        }
    } else {
        weirdName.push(validCombo(weirdName, vowelsStart).toUpperCase());
    }

    for (let i = 0; i < size - 2; i++) {
        isConst = (isConst === false);

        if (sound === "random") {
            isHard = (isHard === false);
        }

        if (isConst) {
            if (isHard) {
                part = validCombo(weirdName, consonantsHardMid).toLowerCase();
            } else {
                part = validCombo(weirdName, consonantsSoftMid).toLowerCase();
            }
        } else {
            if (randRange(0,3) === 0) {
                part = validCombo(weirdName, vowelCombos);
            } else {
                part = validCombo(weirdName, vowels);
            }
        }

        weirdName.push(part);
    }

    isConst = (isConst === false);

    if (isConst) {
        if (isHard) {
            weirdName.push(validCombo(weirdName, consonantsHardEnd));
        } else {
            weirdName.push(validCombo(weirdName, consonantsSoftEnd));
        }

        if (randRange(0, 2) === 0) {
            weirdName.push(validCombo(weirdName, vowels));
        }
    } else {
        weirdName.push(validCombo(weirdName, vowels));

        if (randRange(0, 2) === 0) {
            weirdName.push(validCombo(weirdName, consonants));
        }
    }

    return weirdName.join("");
};

const validCombo = (name: string[], parts: string[]): string => {
    let validPart: string;
    let isValid = true;

    do {
        validPart = parts[randRange(0, parts.length - 1)];

        switch((name[name.length - 1] + validPart).toLowerCase()) {
            case "yy":
            case "quu":
            case "quy":
            case "cie":
            isValid = false;
            break;

            default :
            isValid = true;
            break;
        }

        // Too many y's are a bad thing...
        if (isValid && validPart.indexOf("y") > -1 && randRange(0, 2) === 1) {
            isValid = false;
        }

    } while(!isValid)

    return validPart;
};

const randRange = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const flipCoin = (): boolean => {
    const flip = Math.random();
    if (flip < 0.5) {
        return true;
    } else {
        return false;
    }
}
