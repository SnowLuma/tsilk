/**
 * SILK v3 LTP Tables (CDFs and offsets)
 * Ported from SKP_Silk_tables_LTP.c
 */

export const SKP_Silk_LTP_per_index_CDF = new Uint16Array([0, 20992, 40788, 65535]);
export const SKP_Silk_LTP_per_index_CDF_offset = 1;

export const SKP_Silk_LTP_gain_CDF_0 = new Uint16Array([
    0, 49380, 54463, 56494, 58437, 60101, 61683, 62985, 64066, 64823, 65535
]);

export const SKP_Silk_LTP_gain_CDF_1 = new Uint16Array([
    0, 25290, 30654, 35710, 40386, 42937, 45250, 47459,
    49411, 51348, 52974, 54517, 55976, 57423, 58865, 60285,
    61667, 62895, 63827, 64724, 65535
]);

export const SKP_Silk_LTP_gain_CDF_2 = new Uint16Array([
    0, 4958, 9439, 13581, 17638, 21651, 25015, 28025,
    30287, 32406, 34330, 36240, 38130, 39790, 41281, 42764,
    44229, 45676, 47081, 48431, 49675, 50849, 51932, 52966,
    53957, 54936, 55869, 56789, 57708, 58504, 59285, 60043,
    60796, 61542, 62218, 62871, 63483, 64076, 64583, 65062,
    65535
]);

export const SKP_Silk_LTP_gain_CDF_ptrs: Uint16Array[] = [
    SKP_Silk_LTP_gain_CDF_0,
    SKP_Silk_LTP_gain_CDF_1,
    SKP_Silk_LTP_gain_CDF_2,
];

export const SKP_Silk_LTP_gain_CDF_offsets = [1, 3, 10];

export const SKP_Silk_LTP_gain_middle_avg_RD_Q14 = 11010;

export const SKP_Silk_LTP_gain_BITS_Q6_0 = new Int16Array([
    26, 236, 321, 325, 339, 344, 362, 379, 412, 418
]);

export const SKP_Silk_LTP_gain_BITS_Q6_1 = new Int16Array([
    88, 231, 237, 244, 300, 309, 313, 324,
    325, 341, 346, 351, 352, 352, 354, 356,
    367, 393, 396, 406
]);

export const SKP_Silk_LTP_gain_BITS_Q6_2 = new Int16Array([
    238, 248, 255, 257, 258, 274, 284, 311,
    317, 326, 326, 327, 339, 349, 350, 351,
    352, 355, 358, 366, 371, 379, 383, 387,
    388, 393, 394, 394, 407, 409, 412, 412,
    413, 422, 426, 432, 434, 449, 454, 455
]);

export const SKP_Silk_LTP_gain_BITS_Q6_ptrs: Int16Array[] = [
    SKP_Silk_LTP_gain_BITS_Q6_0,
    SKP_Silk_LTP_gain_BITS_Q6_1,
    SKP_Silk_LTP_gain_BITS_Q6_2
];
