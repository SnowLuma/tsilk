/**
 * SILK v3 Miscellaneous Tables
 * Ported from SKP_Silk_tables_other.c
 */

// Sampling rates
export const SKP_Silk_SamplingRates_table = [8, 12, 16, 24];
export const SKP_Silk_SamplingRates_CDF = new Uint16Array([0, 16000, 32000, 48000, 65535]);
export const SKP_Silk_SamplingRates_offset = 2;

// Type offset
export const SKP_Silk_type_offset_CDF = new Uint16Array([0, 37522, 41030, 44212, 65535]);
export const SKP_Silk_type_offset_CDF_offset = 2;

export const SKP_Silk_type_offset_joint_CDF: Uint16Array[] = [
    new Uint16Array([0, 57686, 61230, 62358, 65535]),
    new Uint16Array([0, 18346, 40067, 43659, 65535]),
    new Uint16Array([0, 22694, 24279, 35507, 65535]),
    new Uint16Array([0, 6067, 7215, 13010, 65535]),
];

// NLSF interpolation factor
export const SKP_Silk_NLSF_interpolation_factor_CDF = new Uint16Array([
    0, 3706, 8703, 19226, 30926, 65535
]);
export const SKP_Silk_NLSF_interpolation_factor_offset = 4;

// Frame termination
export const SKP_Silk_FrameTermination_CDF = new Uint16Array([0, 20000, 45000, 56000, 65535]);
export const SKP_Silk_FrameTermination_offset = 2;

// Random seed
export const SKP_Silk_Seed_CDF = new Uint16Array([0, 16384, 32768, 49152, 65535]);
export const SKP_Silk_Seed_offset = 2;

// VAD flag
export const SKP_Silk_vadflag_CDF = new Uint16Array([0, 22000, 65535]);
export const SKP_Silk_vadflag_offset = 1;

// LSB coding
export const SKP_Silk_lsb_CDF = new Uint16Array([0, 40000, 65535]);

// LTP scale
export const SKP_Silk_LTPscale_CDF = new Uint16Array([0, 32000, 48000, 65535]);
export const SKP_Silk_LTPscale_offset = 2;
export const SKP_Silk_LTPScales_table_Q14 = new Int16Array([15565, 11469, 8192]);

// Quantization offsets
export const SKP_Silk_Quantization_Offsets_Q10: number[][] = [
    [32, 100],   // OFFSET_VL_Q10, OFFSET_VH_Q10
    [100, 256],  // OFFSET_UVL_Q10, OFFSET_UVH_Q10
];

// Piece-wise bitrate -> SNR mapping used by encoder control.
export const TargetRate_table_NB = new Int32Array([0, 8000, 9000, 11000, 13000, 16000, 22000, 100000]);
export const TargetRate_table_MB = new Int32Array([0, 10000, 12000, 14000, 17000, 21000, 28000, 100000]);
export const TargetRate_table_WB = new Int32Array([0, 11000, 14000, 17000, 21000, 26000, 36000, 100000]);
export const TargetRate_table_SWB = new Int32Array([0, 13000, 16000, 19000, 25000, 32000, 46000, 100000]);
export const SNR_table_Q1 = new Int32Array([19, 31, 35, 39, 43, 47, 54, 64]);

// Sign CDF
export const SKP_Silk_sign_CDF = new Uint16Array([
    37840, 36944, 36251, 35304,
    34715, 35503, 34529, 34296,
    34016, 47659, 44945, 42503,
    40235, 38569, 40254, 37851,
    37243, 36595, 43410, 44121,
    43127, 40978, 38845, 40433,
    38252, 37795, 36637, 59159,
    55630, 51806, 48073, 45036,
    48416, 43857, 42678, 41146,
]);

// Decoder HP filter coefficients
export const SKP_Silk_Dec_A_HP_24 = new Int16Array([-16220, 8030]);
export const SKP_Silk_Dec_B_HP_24 = new Int16Array([8000, -16000, 8000]);
export const SKP_Silk_Dec_A_HP_16 = new Int16Array([-16127, 7940]);
export const SKP_Silk_Dec_B_HP_16 = new Int16Array([8000, -16000, 8000]);
export const SKP_Silk_Dec_A_HP_12 = new Int16Array([-16043, 7859]);
export const SKP_Silk_Dec_B_HP_12 = new Int16Array([8000, -16000, 8000]);
export const SKP_Silk_Dec_A_HP_8 = new Int16Array([-15885, 7710]);
export const SKP_Silk_Dec_B_HP_8 = new Int16Array([8000, -16000, 8000]);

// Bandwidth transition smoother tables
export const SKP_Silk_Transition_LP_B_Q28: Int32Array[] = [
    new Int32Array([250767114,  501534038,  250767114]),
    new Int32Array([209867381,  419732057,  209867381]),
    new Int32Array([170987846,  341967853,  170987846]),
    new Int32Array([131531482,  263046905,  131531482]),
    new Int32Array([89306658,   178584282,  89306658])
];

export const SKP_Silk_Transition_LP_A_Q28: Int32Array[] = [
    new Int32Array([506393414,  239854379]),
    new Int32Array([411067935,  169683996]),
    new Int32Array([306733530,  116694253]),
    new Int32Array([185807084,  77959395]),
    new Int32Array([35497197,   57401098])
];
