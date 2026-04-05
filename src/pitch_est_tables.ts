// Definitions For Fix pitch estimator
export const PITCH_EST_SHORTLAG_BIAS_Q15 = 6554;
export const PITCH_EST_PREVLAG_BIAS_Q15 = 6554;
export const PITCH_EST_FLATCONTOUR_BIAS_Q20 = 52429;

export const PITCH_EST_MAX_FS_KHZ = 24;
export const PITCH_EST_FRAME_LENGTH_MS = 40;

export const PITCH_EST_MAX_FRAME_LENGTH = PITCH_EST_FRAME_LENGTH_MS * PITCH_EST_MAX_FS_KHZ;
export const PITCH_EST_MAX_FRAME_LENGTH_ST_1 = PITCH_EST_MAX_FRAME_LENGTH >> 2;
export const PITCH_EST_MAX_FRAME_LENGTH_ST_2 = PITCH_EST_MAX_FRAME_LENGTH >> 1;
export const PITCH_EST_MAX_SF_FRAME_LENGTH = 5 * PITCH_EST_MAX_FS_KHZ; // PITCH_EST_SUB_FRAME = 5

export const PITCH_EST_MAX_LAG_MS = 18;
export const PITCH_EST_MIN_LAG_MS = 2;
export const PITCH_EST_MAX_LAG = PITCH_EST_MAX_LAG_MS * PITCH_EST_MAX_FS_KHZ;
export const PITCH_EST_MIN_LAG = PITCH_EST_MIN_LAG_MS * PITCH_EST_MAX_FS_KHZ;

export const PITCH_EST_NB_SUBFR = 4;
export const PITCH_EST_D_SRCH_LENGTH = 24;
export const PITCH_EST_MAX_DECIMATE_STATE_LENGTH = 7;
export const PITCH_EST_NB_STAGE3_LAGS = 5;

export const PITCH_EST_NB_CBKS_STAGE2 = 3;
export const PITCH_EST_NB_CBKS_STAGE2_EXT = 11;

export const PITCH_EST_CB_mn2 = 1;
export const PITCH_EST_CB_mx2 = 2;

export const PITCH_EST_NB_CBKS_STAGE3_MAX = 34;
export const PITCH_EST_NB_CBKS_STAGE3_MID = 24;
export const PITCH_EST_NB_CBKS_STAGE3_MIN = 16;

export const SKP_Silk_PITCH_EST_MIN_COMPLEX = 0;
export const SKP_Silk_PITCH_EST_MID_COMPLEX = 1;
export const SKP_Silk_PITCH_EST_MAX_COMPLEX = 2;

export const SKP_Silk_CB_lags_stage2 = [
    new Int16Array([0, 2,-1,-1,-1, 0, 0, 1, 1, 0, 1]),
    new Int16Array([0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0]),
    new Int16Array([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]),
    new Int16Array([0,-1, 2, 1, 0, 1, 1, 0, 0,-1,-1])
];

export const SKP_Silk_CB_lags_stage3 = [
    new Int16Array([-9,-7,-6,-5,-5,-4,-4,-3,-3,-2,-2,-2,-1,-1,-1, 0, 0, 0, 1, 1, 0, 1, 2, 2, 2, 3, 3, 4, 4, 5, 6, 5, 6, 8]),
    new Int16Array([-3,-2,-2,-2,-1,-1,-1,-1,-1, 0, 0,-1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 2, 1, 2, 2, 2, 2, 3]),
    new Int16Array([ 3, 3, 2, 2, 2, 2, 1, 2, 1, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,-1, 0, 0,-1,-1,-1,-1,-1,-2,-2,-2]),
    new Int16Array([ 9, 8, 6, 5, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 0, 1, 1, 0, 0, 0,-1,-1,-1,-2,-2,-2,-3,-3,-4,-4,-5,-5,-6,-7])
];

export const SKP_Silk_Lag_range_stage3 = [
    [ // MIN_COMPLEX (0)
        new Int16Array([-2,6]),
        new Int16Array([-1,5]),
        new Int16Array([-1,5]),
        new Int16Array([-2,7])
    ],
    [ // MID_COMPLEX (1)
        new Int16Array([-4,8]),
        new Int16Array([-1,6]),
        new Int16Array([-1,6]),
        new Int16Array([-4,9])
    ],
    [ // MAX_COMPLEX (2)
        new Int16Array([-9,12]),
        new Int16Array([-3,7]),
        new Int16Array([-2,7]),
        new Int16Array([-7,13])
    ]
];

export const SKP_Silk_cbk_sizes_stage3 = new Int16Array([
    PITCH_EST_NB_CBKS_STAGE3_MIN,
    PITCH_EST_NB_CBKS_STAGE3_MID,
    PITCH_EST_NB_CBKS_STAGE3_MAX
]);

export const SKP_Silk_cbk_offsets_stage3 = new Int16Array([
    (PITCH_EST_NB_CBKS_STAGE3_MAX - PITCH_EST_NB_CBKS_STAGE3_MIN) >> 1,
    (PITCH_EST_NB_CBKS_STAGE3_MAX - PITCH_EST_NB_CBKS_STAGE3_MID) >> 1,
    0
]);
