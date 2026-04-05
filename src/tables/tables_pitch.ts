/**
 * SILK v3 Pitch Lag Tables
 * Ported from SKP_Silk_tables_pitch_lag.c
 */

export const PITCH_EST_MIN_LAG_MS = 2;
export const PITCH_EST_MAX_LAG_MS = 18;
export const PITCH_EST_NB_SUBFR = 4;
export const PITCH_EST_NB_CBKS_STAGE2_EXT = 11;
export const PITCH_EST_NB_CBKS_STAGE3_MAX = 34;

export const SKP_Silk_pitch_lag_NB_CDF_offset = 43;
export const SKP_Silk_pitch_contour_NB_CDF_offset = 5;
export const SKP_Silk_pitch_lag_MB_CDF_offset = 64;
export const SKP_Silk_pitch_lag_WB_CDF_offset = 86;
export const SKP_Silk_pitch_lag_SWB_CDF_offset = 128;
export const SKP_Silk_pitch_contour_CDF_offset = 17;

export const SKP_Silk_pitch_contour_NB_CDF = new Uint16Array([
    0, 14445, 18587, 25628, 30013, 34859, 40597, 48426,
    54460, 59033, 62990, 65535
]);

export const SKP_Silk_pitch_contour_CDF = new Uint16Array([
    0, 372, 843, 1315, 1836, 2644, 3576, 4719,
    6088, 7621, 9396, 11509, 14245, 17618, 20777, 24294,
    27992, 33116, 40100, 44329, 47558, 50679, 53130, 55557,
    57510, 59022, 60285, 61345, 62316, 63140, 63762, 64321,
    64729, 65099, 65535
]);

// Pitch contour codebooks for decode_pitch
export const SKP_Silk_CB_lags_stage2: number[][] = [
    [0, 2, -1, -1, -1, 0, 0, 1, 1, 0, 1],
    [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
    [0, -1, 2, 1, 0, 1, 1, 0, 0, -1, -1],
];

export const SKP_Silk_CB_lags_stage3: number[][] = [
    [-9,-7,-6,-5,-5,-4,-4,-3,-3,-2,-2,-2,-1,-1,-1,0,0,0,1,1,0,1,2,2,2,3,3,4,4,5,6,5,6,8],
    [-3,-2,-2,-2,-1,-1,-1,-1,-1,0,0,-1,0,0,0,0,0,0,1,0,0,0,1,1,0,1,1,2,1,2,2,2,2,3],
    [3,3,2,2,2,2,1,2,1,1,0,1,1,0,0,0,1,0,0,0,0,0,0,-1,0,0,-1,-1,-1,-1,-1,-2,-2,-2],
    [9,8,6,5,6,5,4,4,3,3,2,2,2,1,0,1,1,0,0,0,-1,-1,-1,-2,-2,-2,-3,-3,-4,-4,-5,-5,-6,-7],
];
