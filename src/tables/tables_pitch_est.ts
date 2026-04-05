// Pitch Estimation Tables

export const SKP_Silk_CB_lags_stage2: Int16Array[] = [
    new Int16Array([0, 2,-1,-1,-1, 0, 0, 1, 1, 0, 1]),
    new Int16Array([0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
    new Int16Array([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]),
    new Int16Array([0,-1, 2, 1, 0, 1, 1, 0, 0,-1,-1])
];

export const SKP_Silk_CB_lags_stage3: Int16Array[] = [
    new Int16Array([-9,-7,-6,-5,-5,-4,-4,-3,-3,-2,-2,-2,-1,-1,-1, 0, 0, 0, 1, 1, 0, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 5, 6, 8]),
    new Int16Array([-3,-2,-2,-2,-1,-1,-1,-1,-1, 0, 0,-1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 2, 1, 2, 2, 2, 2, 3]),
    new Int16Array([ 3, 3, 2, 2, 2, 2, 1, 2, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,-1, 0, 0,-1,-1,-1,-1,-1,-2,-2,-2]),
    new Int16Array([ 9, 8, 6, 5, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 0, 1, 1, 0, 0, 0,-1,-1,-1,-2,-2,-2,-3,-3,-4,-4,-5,-5,-6,-7])
];

export const SKP_Silk_Lag_range_stage3: Int16Array[][] = [
    [ // Lags to search for low number of stage3 cbks
        new Int16Array([-2, 6]),
        new Int16Array([-1, 5]),
        new Int16Array([-1, 5]),
        new Int16Array([-2, 7])
    ],
    [ // Lags to search for middle number of stage3 cbks
        new Int16Array([-4, 8]),
        new Int16Array([-1, 6]),
        new Int16Array([-1, 6]),
        new Int16Array([-4, 9])
    ],
    [ // Lags to search for max number of stage3 cbks
        new Int16Array([-9, 12]),
        new Int16Array([-3, 7]),
        new Int16Array([-2, 7]),
        new Int16Array([-7, 13])
    ]
];

export const SKP_Silk_cbk_sizes_stage3 = new Int16Array([
    16, // PITCH_EST_NB_CBKS_STAGE3_MIN
    24, // PITCH_EST_NB_CBKS_STAGE3_MID
    34  // PITCH_EST_NB_CBKS_STAGE3_MAX
]);

export const SKP_Silk_cbk_offsets_stage3 = new Int16Array([
    9, // ((34 - 16) >> 1)
    5, // ((34 - 24) >> 1)
    0
]);
