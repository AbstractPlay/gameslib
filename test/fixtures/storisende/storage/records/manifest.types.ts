export type StorisendeRecordManifestEntry = {
    variant: string;
    file: string;
    gameid: string;
    siteGameId: string;
    stackFrames: number;
    sourceStackFrames: number;
    moveRounds: number;
};

export type StorisendeRecordManifest = {
    generated: string;
    fixtures: StorisendeRecordManifestEntry[];
    skipped: { variant: string; reason: string }[];
};
