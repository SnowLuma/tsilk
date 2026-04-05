/**
 * SILK v3 Fixed-point arithmetic macros
 * Ported from SKP_Silk_macros.h, SKP_Silk_SigProc_FIX.h, SKP_Silk_Inlines.h
 */

// Integer limits for 32-bit simulation
const INT32_MAX = 0x7FFFFFFF;
const INT32_MIN = -0x80000000;
const INT16_MAX = 0x7FFF;
const INT16_MIN = -0x8000;
const UINT32_MAX = 0xFFFFFFFF;
export const SKP_INT32_MAX = INT32_MAX;

/** Ensure value stays within 32-bit signed integer range */
export function toInt32(x: number): number {
    return x | 0;
}

/** Ensure value stays within 16-bit signed integer range */
export function toInt16(x: number): number {
    return ((x << 16) >> 16);
}

/** Unsigned 32-bit interpretation */
export function toUint32(x: number): number {
    return x >>> 0;
}

/** Saturate to 16-bit */
export function SKP_SAT16(x: number): number {
    if (x > INT16_MAX) return INT16_MAX;
    if (x < INT16_MIN) return INT16_MIN;
    return x;
}

/** Saturate to 32-bit */
export function SKP_SAT32(x: number): number {
    if (x > INT32_MAX) return INT32_MAX;
    if (x < INT32_MIN) return INT32_MIN;
    return x;
}

/** Arithmetic right shift */
export function SKP_RSHIFT(a: number, shift: number): number {
    return a >> shift;
}

export function SKP_RSHIFT32(a: number, shift: number): number {
    return SKP_RSHIFT(a, shift);
}

/** Unsigned right shift */
export function SKP_RSHIFT_uint(a: number, shift: number): number {
    return (a >>> shift);
}

/** Left shift */
export function SKP_LSHIFT(a: number, shift: number): number {
    return toInt32(a << shift);
}

/** Left shift with overflow allowed (unsigned) */
export function SKP_LSHIFT_ovflw(a: number, shift: number): number {
    return toUint32(a << shift);
}

/** Unsigned left shift */
export function SKP_LSHIFT_uint(a: number, shift: number): number {
    return toUint32(a << shift);
}

/** Right shift with rounding */
export function SKP_RSHIFT_ROUND(a: number, shift: number): number {
    if (shift === 0) return a;
    if (shift === 1) return ((a >> 1) + (a & 1)) | 0;
    return toInt32((a >> (shift - 1)) + 1) >> 1;
}

/** Multiply 32x32 -> 32 (low bits) */
export function SKP_MUL(a: number, b: number): number {
    return toInt32(Math.imul(a, b));
}

/** Unsigned multiply */
export function SKP_MUL_uint(a: number, b: number): number {
    // Use BigInt for unsigned 32-bit multiplication accuracy
    const result = (BigInt(a >>> 0) * BigInt(b >>> 0));
    return Number(result & BigInt(0xFFFFFFFF));
}

/** Multiply and accumulate */
export function SKP_MLA(a32: number, b32: number, c32: number): number {
    return toInt32(a32 + Math.imul(b32, c32));
}

/** Multiply 32x16 -> 32 */
export function SKP_SMULWB(a32: number, b16: number): number {
    a32 = a32 | 0;
    const b32 = toInt16(b16) | 0;
    const term1 = Math.imul(a32 >> 16, b32) | 0;
    // Low half of a32 is unsigned in the C macro: (a32 & 0xFFFF) * b16.
    const term2 = (toInt32((a32 & 0xFFFF) * b32) >> 16) | 0;
    return (term1 + term2) | 0;
}

/** Multiply 32x16 (top) -> 32 */
export function SKP_SMLAWB(a32: number, b32: number, c16: number): number {
    return toInt32(a32 + SKP_SMULWB(b32, c16));
}

/** Multiply 32x16 (high part of c) -> 32 */
export function SKP_SMULWT(a32: number, b32: number): number {
    a32 = a32 | 0;
    b32 = b32 | 0;
    const term1 = Math.imul(a32 >> 16, b32 >> 16) | 0;
    // Low half of a32 is unsigned in the C macro.
    const term2 = (toInt32((a32 & 0xFFFF) * (b32 >> 16)) >> 16) | 0;
    return (term1 + term2) | 0;
}

/** Multiply 32x16 (top) -> 32 with accumulate */
export function SKP_SMLAWT(a32: number, b32: number, c32: number): number {
    return toInt32(a32 + SKP_SMULWT(b32, c32));
}

/** Multiply 32x32 -> keeping upper 32 bits (>>16) */
export function SKP_SMULWW(a32: number, b32: number): number {
    return SKP_MLA(SKP_SMULWB(a32, b32), a32, SKP_RSHIFT_ROUND(b32, 16));
}

/** Multiply 32x32 -> keeping upper 32 bits (>>32). Matches ARM SMMUL. */
export function SKP_SMMUL(a32: number, b32: number): number {
    const r = BigInt(a32) * BigInt(b32);
    return Number(r >> BigInt(32)) | 0;
}

/** Multiply 16x16 -> 32 */
export function SKP_SMULBB(a16: number, b16: number): number {
    return toInt32(toInt16(a16) * toInt16(b16));
}

/** 32-bit division */
export function SKP_DIV32(a: number, b: number): number {
    return toInt32(Math.trunc(a / b));
}

/** Variable Q division */
export function SKP_DIV32_varQ(a: number, b: number, Qres: number): number {
    if (b === 0) return a >= 0 ? INT32_MAX : INT32_MIN;
    if (Qres < 0) return 0;

    const absA = Math.abs(a | 0);
    const absB = Math.abs(b | 0);
    if (absA === 0) return 0;

    const a_headrm = SKP_Silk_CLZ32(absA) - 1;
    let a32_nrm = SKP_LSHIFT(a, a_headrm);
    const b_headrm = SKP_Silk_CLZ32(absB) - 1;
    const b32_nrm = SKP_LSHIFT(b, b_headrm);

    const b32_inv = SKP_DIV32_16(INT32_MAX >> 2, SKP_RSHIFT(b32_nrm, 16));
    let result = SKP_SMULWB(a32_nrm, b32_inv);

    a32_nrm = toInt32(a32_nrm - (SKP_LSHIFT_ovflw(SKP_SMMUL(b32_nrm, result), 3) | 0));
    result = SKP_SMLAWB(result, a32_nrm, b32_inv);

    const lshift = 29 + a_headrm - b_headrm - Qres;
    if (lshift <= 0) {
        return SKP_LSHIFT_SAT32(result, -lshift);
    }
    if (lshift < 32) {
        return SKP_RSHIFT(result, lshift);
    }
    return 0;
}

/** RAND macro */
export function SKP_RAND(seed: number): number {
    return toInt32(SKP_MLA(907633515, seed, 196314165));
}

/** Min/Max */
export function SKP_min(a: number, b: number): number {
    return a < b ? a : b;
}

export function SKP_max(a: number, b: number): number {
    return a > b ? a : b;
}

export function SKP_min_32(a: number, b: number): number {
    return a < b ? a : b;
}

export function SKP_max_32(a: number, b: number): number {
    return a > b ? a : b;
}

export function SKP_min_int(a: number, b: number): number {
    return a < b ? a : b;
}

export function SKP_max_int(a: number, b: number): number {
    return a > b ? a : b;
}

export function SKP_max_16(a: number, b: number): number {
    return a > b ? a : b;
}

export function SKP_LIMIT_int(a: number, lo: number, hi: number): number {
    if (a < lo) return lo;
    if (a > hi) return hi;
    return a;
}

export function SKP_LIMIT_32(a: number, lo: number, hi: number): number {
    if (a < lo) return lo;
    if (a > hi) return hi;
    return a;
}

/** Count leading zeros */
export function SKP_Silk_CLZ32(x: number): number {
    return Math.clz32(x >>> 0);
}

/** Count leading zeros for 16 bit */
export function SKP_Silk_CLZ16(x: number): number {
    return Math.clz32((x & 0xFFFF) >>> 0) - 16;
}

/** Inverse of a 32-bit variable with variable Q format output */
export function SKP_INVERSE32_varQ(b32: number, Qres: number): number {
    if (b32 === 0) return INT32_MAX;
    if (Qres <= 0) return 0;

    const absB = Math.abs(b32 | 0);
    const b_headrm = SKP_Silk_CLZ32(absB) - 1;
    const b32_nrm = SKP_LSHIFT(b32, b_headrm);

    const b32_inv = SKP_DIV32_16(INT32_MAX >> 2, SKP_RSHIFT(b32_nrm, 16));
    let result = SKP_LSHIFT(b32_inv, 16);

    const err_Q32 = SKP_LSHIFT_ovflw(-SKP_SMULWB(b32_nrm, b32_inv), 3) | 0;
    result = SKP_SMLAWW(result, err_Q32, b32_inv);

    const lshift = 61 - b_headrm - Qres;
    if (lshift <= 0) {
        return SKP_LSHIFT_SAT32(result, -lshift);
    }
    if (lshift < 32) {
        return SKP_RSHIFT(result, lshift);
    }
    return 0;
}

/** Log2 approximation (returns Q7 value) */
export function SKP_Silk_lin2log(inLin: number): number {
    if (inLin <= 0) return 0;
    const lz = SKP_Silk_CLZ32(inLin);
    const frac_Q7 = toInt32(SKP_RSHIFT(SKP_LSHIFT(inLin, lz) & 0x7FFFFFFF, 24));
    return toInt32(((31 - lz) << 7) + SKP_SMLAWB(frac_Q7, frac_Q7 * (128 - frac_Q7), 179));
}

/** Inverse log2 approximation (input Q7, output linear) */
export function SKP_Silk_log2lin(inLog_Q7: number): number {
    if (inLog_Q7 < 0) return 0;
    if (inLog_Q7 >= 3968) return INT32_MAX; // 31 in Q7
    let out = toInt32(1 << (inLog_Q7 >> 7));
    let frac_Q7 = inLog_Q7 & 0x7F;
    let smlawb = SKP_SMLAWB(frac_Q7, frac_Q7 * (128 - frac_Q7), -174);
    if (inLog_Q7 < 2048) {
        return toInt32(out + SKP_RSHIFT(SKP_MUL(out, smlawb), 7));
    } else {
        return toInt32(out + SKP_MUL(SKP_RSHIFT(out, 7), smlawb));
    }
}

/** MA prediction */
export function SKP_Silk_MA_Prediction(
    input: Int16Array, inputOffset: number,
    B_Q12: Int16Array, BOffset: number,
    S: Int32Array, SOffset: number,
    output: Int16Array, outputOffset: number,
    length: number,
    order: number
): void {
    for (let ix = 0; ix < length; ix++) {
        const in16 = input[inputOffset + ix] | 0;
        let out32 = SKP_LSHIFT(in16, 12) - (S[SOffset + 0] | 0);
        out32 = SKP_RSHIFT_ROUND(out32, 12);

        for (let d = 0; d < order - 1; d++) {
            S[SOffset + d] = SKP_SMLABB(S[SOffset + d + 1], in16, B_Q12[BOffset + d]);
        }
        S[SOffset + order - 1] = SKP_SMULBB(in16, B_Q12[BOffset + order - 1]);

        output[outputOffset + ix] = toInt16(SKP_SAT16(out32));
    }
}

export function SKP_Silk_bwexpander(
    ar: Int16Array, arOffset: number,
    d: number,
    chirp_Q16: number
): void {
    let chirp_minus_one_Q16 = chirp_Q16 - 65536;

    for (let i = 0; i < d - 1; i++) {
        ar[arOffset + i] = toInt16(SKP_RSHIFT_ROUND(SKP_MUL(chirp_Q16, ar[arOffset + i]), 16));
        chirp_Q16 = toInt32(chirp_Q16 + SKP_RSHIFT_ROUND(SKP_MUL(chirp_Q16, chirp_minus_one_Q16), 16));
    }
    ar[arOffset + d - 1] = toInt16(SKP_RSHIFT_ROUND(SKP_MUL(chirp_Q16, ar[arOffset + d - 1]), 16));
}

/** Biquad filter */
export function SKP_Silk_biquad(
    input: Int16Array, inOffset: number,
    B_Q13: Int16Array, BOffset: number,
    A_Q13: Int16Array, AOffset: number,
    S: Int32Array, SOffset: number,
    output: Int16Array, outOffset: number,
    len: number
): void {
    let S0 = S[SOffset + 0] | 0;
    let S1 = S[SOffset + 1] | 0;
    const A0_neg = (-A_Q13[AOffset + 0]) | 0;
    const A1_neg = (-A_Q13[AOffset + 1]) | 0;

    for (let k = 0; k < len; k++) {
        const in16 = input[inOffset + k] | 0;
        const out32 = SKP_SMLABB(S0, in16, B_Q13[BOffset + 0]);

        S0 = SKP_SMLABB(S1, in16, B_Q13[BOffset + 1]);
        S0 = toInt32(S0 + SKP_LSHIFT(SKP_SMULWB(out32, A0_neg), 3));

        S1 = SKP_LSHIFT(SKP_SMULWB(out32, A1_neg), 3);
        S1 = SKP_SMLABB(S1, in16, B_Q13[BOffset + 2]);

        const tmp32 = SKP_RSHIFT_ROUND(out32, 13) + 1;
        output[outOffset + k] = toInt16(SKP_SAT16(tmp32));
    }

    S[SOffset + 0] = S0;
    S[SOffset + 1] = S1;
}

/** Abs value */
export function SKP_abs(a: number): number {
    return a < 0 ? -a : a;
}

/** 32-bit Addition with wrapping */
export function SKP_ADD32(a: number, b: number): number {
    return toInt32(a + b);
}

export function SKP_ADD32_ovflw(a: number, b: number): number {
    return (((a >>> 0) + (b >>> 0)) >>> 0) | 0;
}

export function SKP_ADD_RSHIFT(a: number, b: number, shift: number): number {
    return SKP_ADD32(a, SKP_RSHIFT(b, shift));
}

export function SKP_ADD_LSHIFT32(a: number, b: number, shift: number): number {
    return SKP_ADD32(a, SKP_LSHIFT(b, shift));
}

export function SKP_LSHIFT32(a: number, shift: number): number {
    return SKP_LSHIFT(a, shift);
}

export function SKP_SUB_SAT32(a: number, b: number): number {
    return SKP_ADD_SAT32(a, -b);
}

export function SKP_SUB32(a: number, b: number): number {
    return toInt32(a - b);
}

export function SKP_DIV32_16(a32: number, b16: number): number {
    return Math.trunc(a32 / b16) | 0;
}

export function SKP_SMLABB(a32: number, b16: number, c16: number): number {
    return toInt32(a32 + Math.imul(toInt16(b16), toInt16(c16)));
}

export function SKP_SMLABB_ovflw(a32: number, b16: number, c16: number): number {
    return SKP_ADD32_ovflw(a32, SKP_SMULBB(b16, c16));
}

export function SKP_ADD_POS_SAT32(a: number, b: number): number {
    let res = toInt32(a + b);
    return (res < 0 && a > 0 && b > 0) ? 0x7FFFFFFF : res;
}

/** Right rotate 32-bit */
function SKP_ROR32(x: number, shift: number): number {
    shift &= 31;
    if (shift === 0) return x;
    return (x >>> shift) | (x << (32 - shift));
}

/** Get number of leading zeros and fractional part */
function SKP_Silk_CLZ_FRAC(in_val: number): { lz: number, frac_Q7: number } {
    const lz = SKP_Silk_CLZ32(in_val);
    const frac_Q7 = SKP_ROR32(in_val, 24 - lz) & 0x7f;
    return { lz, frac_Q7 };
}

/** Approximation of square root */
export function SKP_Silk_SQRT_APPROX(x: number): number {
    if (x <= 0) return 0;
    const { lz, frac_Q7 } = SKP_Silk_CLZ_FRAC(x);
    let y = (lz & 1) ? 32768 : 46214;
    y >>= SKP_RSHIFT(lz, 1);
    y = SKP_SMLAWB(y, y, SKP_SMULBB(213, frac_Q7));
    return y;
}

export function SKP_SMLAWW(a32: number, b32: number, c32: number): number {
    return SKP_MLA(SKP_SMLAWB(a32, b32, c32), b32, SKP_RSHIFT_ROUND(c32, 16));
}

export function SKP_FIX_CONST(v: number, Q: number): number {
    return Math.trunc(v * Math.pow(2, Q) + 0.5);
}

export function SKP_Silk_sigm_Q15(in_Q5: number): number {
    return sigm_Q15(in_Q5);
}

export function SKP_ADD_SAT32(a32: number, b32: number): number {
    let sum = a32 + b32;
    if (sum > 2147483647) return 2147483647;
    if (sum < -2147483648) return -2147483648;
    return sum;
}

export function SKP_abs_int32(a: number): number {
    return Math.abs(a);
}

export function SKP_Silk_sum_sqr_shift(nrg: { val: number }, scale: { val: number }, x: Int16Array, len: number): void {
    let shft = 0;
    let nrgVal = 0;
    let i = 0;

    // Match C alignment path: if int16 pointer is not 4-byte aligned, consume one sample first.
    if ((x.byteOffset & 2) !== 0 && len > 0) {
        nrgVal = Math.imul(x[0], x[0]) | 0;
        i = 1;
    }

    const lenM1 = len - 1;
    while (i < lenM1) {
        nrgVal = toInt32(nrgVal + Math.imul(x[i], x[i]));
        nrgVal = toInt32(nrgVal + Math.imul(x[i + 1], x[i + 1]));
        i += 2;
        if (nrgVal < 0) {
            nrgVal = (nrgVal >>> 2) | 0;
            shft = 2;
            break;
        }
    }

    for (; i < lenM1; i += 2) {
        let nrgTmp = Math.imul(x[i], x[i]);
        nrgTmp = toInt32(nrgTmp + Math.imul(x[i + 1], x[i + 1]));
        nrgVal = toInt32(nrgVal + (nrgTmp >>> shft));
        if (nrgVal < 0) {
            nrgVal = (nrgVal >>> 2) | 0;
            shft += 2;
        }
    }

    if (i === lenM1) {
        const nrgTmp = Math.imul(x[i], x[i]);
        nrgVal = toInt32(nrgVal + (nrgTmp >>> shft));
    }

    if ((nrgVal & 0xC0000000) !== 0) {
        nrgVal = (nrgVal >>> 2) | 0;
        shft += 2;
    }

    nrg.val = nrgVal;
    scale.val = shft;
}

export function SKP_LSHIFT_SAT32(a: number, shift: number): number {
    if (shift <= 0) return toInt32(a);
    if (shift >= 31) {
        return a > 0 ? INT32_MAX : (a < 0 ? INT32_MIN : 0);
    }
    const v = BigInt(a | 0) << BigInt(shift);
    const max = BigInt(INT32_MAX);
    const min = BigInt(INT32_MIN);
    if (v > max) return INT32_MAX;
    if (v < min) return INT32_MIN;
    return Number(v) | 0;
}

export const SQRT_APPROX = SKP_Silk_SQRT_APPROX;

const sigm_LUT_slope_Q10 = new Int32Array([237, 153, 73, 30, 12, 7]);
const sigm_LUT_pos_Q15 = new Int32Array([16384, 23955, 28861, 31213, 32178, 32548]);
const sigm_LUT_neg_Q15 = new Int32Array([16384, 8812, 3906, 1554, 589, 219]);

export function sigm_Q15(in_Q5: number): number {
    let ind: number;
    if (in_Q5 < 0) {
        in_Q5 = -in_Q5;
        if (in_Q5 >= 6 * 32) {
            return 0; // clip
        } else {
            ind = SKP_RSHIFT(in_Q5, 5);
            return (sigm_LUT_neg_Q15[ind] - SKP_SMULBB(sigm_LUT_slope_Q10[ind], in_Q5 & 0x1F));
        }
    } else {
        if (in_Q5 >= 6 * 32) {
            return 32767; // clip
        } else {
            ind = SKP_RSHIFT(in_Q5, 5);
            return (sigm_LUT_pos_Q15[ind] + SKP_SMULBB(sigm_LUT_slope_Q10[ind], in_Q5 & 0x1F));
        }
    }
}

export const lin2log = SKP_Silk_lin2log;

export function SKP_Silk_biquad_alt(
    inData: Int16Array | number[],
    inOffset: number,
    B_Q28: Int32Array,
    A_Q28: Int32Array,
    S: Int32Array | number[],
    outData: Int16Array,
    outOffset: number,
    len: number
): void {
    const A0_L_Q28 = (-A_Q28[0]) & 0x00003FFF;
    const A0_U_Q28 = SKP_RSHIFT(-A_Q28[0], 14);
    const A1_L_Q28 = (-A_Q28[1]) & 0x00003FFF;
    const A1_U_Q28 = SKP_RSHIFT(-A_Q28[1], 14);

    for (let k = 0; k < len; k++) {
        let inval = inData[inOffset + k];
        let out32_Q14 = SKP_LSHIFT(SKP_SMLAWB(S[0], B_Q28[0], inval), 2);

        S[0] = S[1] + SKP_RSHIFT_ROUND(SKP_SMULWB(out32_Q14, A0_L_Q28), 14);
        S[0] = SKP_SMLAWB(S[0], out32_Q14, A0_U_Q28);
        S[0] = SKP_SMLAWB(S[0], B_Q28[1], inval);

        S[1] = SKP_RSHIFT_ROUND(SKP_SMULWB(out32_Q14, A1_L_Q28), 14);
        S[1] = SKP_SMLAWB(S[1], out32_Q14, A1_U_Q28);
        S[1] = SKP_SMLAWB(S[1], B_Q28[2], inval);

        outData[outOffset + k] = SKP_SAT16(SKP_RSHIFT(out32_Q14 + (1 << 14) - 1, 14));
    }
}
export const biquad_alt = SKP_Silk_biquad_alt;

export function SKP_ADD_SAT16(a: number, b: number): number {
    let sum = a + b;
    if (sum > 32767) return 32767;
    if (sum < -32768) return -32768;
    return sum;
}

export function Math_imul(a: number, b: number): number {
    return Math.imul(a, b);
}

export function SKP_SQRT_APPROX(x: number): number {
    if (x <= 0) return 0;

    let lz = SKP_Silk_CLZ32(x);
    let shift = 24 - lz;
    let frac_Q7 = (shift >= 0 ? (x >>> shift) : (x << -shift)) & 0x7f;

    let y = (lz & 1) ? 32768 : 46214;
    y >>= (lz >> 1);

    y = SKP_SMLAWB(y, y, SKP_SMULBB(213, frac_Q7));
    return y;
}
