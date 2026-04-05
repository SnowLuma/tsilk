/**
 * NLSF to LPC coefficient conversion
 * Faithfully ported from SKP_Silk_NLSF2A.c + SKP_Silk_NLSF2A_stable.c
 */
import { MAX_LPC_ORDER, MAX_LPC_STABILIZE_ITERATIONS } from './defines';
import {
    toInt32, toInt16, SKP_RSHIFT, SKP_LSHIFT, SKP_RSHIFT_ROUND,
    SKP_SMULBB, SKP_SAT16, SKP_MUL, SKP_abs, SKP_min,
    SKP_Silk_bwexpander, SKP_DIV32, SKP_SMULWB, SKP_SMLAWB,
    SKP_SMMUL, SKP_INVERSE32_varQ, SKP_Silk_CLZ32, SKP_SMULWW,
} from './macros';
import { SKP_Silk_LSFCosTab_FIX_Q12, LSF_COS_TAB_SZ_FIX } from './tables/tables_lsf_cos';

const SKP_Silk_MAX_ORDER_LPC = 16;

/** Helper: find polynomial from interleaved 2*cos(LSF) values */
function NLSF2A_find_poly(
    out: Int32Array, outOff: number,
    cLSF: Int32Array, cLSFOff: number,
    dd: number
): void {
    out[outOff + 0] = 1 << 20;
    out[outOff + 1] = -cLSF[cLSFOff + 0];
    for (let k = 1; k < dd; k++) {
        const ftmp = cLSF[cLSFOff + 2 * k]; // Q20
        // out[k+1] = 2*out[k-1] - round64(ftmp * out[k], 20)
        const mul64 = BigInt(ftmp) * BigInt(out[outOff + k]);
        out[outOff + k + 1] = toInt32(
            (out[outOff + k - 1] << 1) - Number((mul64 + (1n << 19n)) >> 20n)
        );
        for (let n = k; n > 1; n--) {
            const mul64n = BigInt(ftmp) * BigInt(out[outOff + n - 1]);
            out[outOff + n] = toInt32(
                out[outOff + n] + out[outOff + n - 2] - Number((mul64n + (1n << 19n)) >> 20n)
            );
        }
        out[outOff + 1] = toInt32(out[outOff + 1] - ftmp);
    }
}

/** Compute whitening filter coefficients from NLSF (Q15 input -> Q12 output) */
export function NLSF2A(
    a: Int16Array,
    NLSF: Int32Array,
    d: number
): void {
    const cos_LSF_Q20 = new Int32Array(SKP_Silk_MAX_ORDER_LPC);
    const P = new Int32Array(SKP_Silk_MAX_ORDER_LPC / 2 + 1);
    const Q = new Int32Array(SKP_Silk_MAX_ORDER_LPC / 2 + 1);
    const a_int32 = new Int32Array(SKP_Silk_MAX_ORDER_LPC);

    // Convert NLSF to 2*cos(LSF) using piecewise linear table
    for (let k = 0; k < d; k++) {
        const f_int = NLSF[k] >> (15 - 7);
        const f_frac = NLSF[k] - (f_int << (15 - 7));
        const cos_val = SKP_Silk_LSFCosTab_FIX_Q12[f_int];
        const delta = SKP_Silk_LSFCosTab_FIX_Q12[f_int + 1] - cos_val;
        cos_LSF_Q20[k] = toInt32((cos_val << 8) + SKP_MUL(delta, f_frac));
    }

    const dd = d >> 1;

    // Generate even and odd polynomials
    NLSF2A_find_poly(P, 0, cos_LSF_Q20, 0, dd);
    NLSF2A_find_poly(Q, 0, cos_LSF_Q20, 1, dd);

    // Convert to Q12 filter coefs
    for (let k = 0; k < dd; k++) {
        const Ptmp = toInt32(P[k + 1] + P[k]);
        const Qtmp = toInt32(Q[k + 1] - Q[k]);
        a_int32[k] = -SKP_RSHIFT_ROUND(toInt32(Ptmp + Qtmp), 9);
        a_int32[d - k - 1] = SKP_RSHIFT_ROUND(toInt32(Qtmp - Ptmp), 9);
    }

    // Limit maximum absolute value
    for (let i = 0; i < 10; i++) {
        let maxabs = 0, idx = 0;
        for (let k = 0; k < d; k++) {
            const absval = SKP_abs(a_int32[k]);
            if (absval > maxabs) { maxabs = absval; idx = k; }
        }
        if (maxabs > 32767) {
            maxabs = SKP_min(maxabs, 98369);
            const sc_Q16 = toInt32(65470 - SKP_DIV32(
                SKP_MUL(65470 >> 2, maxabs - 32767),
                SKP_RSHIFT(SKP_MUL(maxabs, idx + 1), 2)
            ));
            bwexpander_32(a_int32, d, sc_Q16);
        } else {
            break;
        }
    }

    // Output as Q12 int16
    for (let k = 0; k < d; k++) {
        a[k] = toInt16(SKP_SAT16(a_int32[k]));
    }
}

function bwexpander_32(ar: Int32Array, d: number, chirp_Q16: number): void {
    let chirp = chirp_Q16;
    for (let i = 0; i < d - 1; i++) {
        ar[i] = toInt32(SKP_SMULWW(chirp, ar[i]));
        chirp = toInt32(SKP_SMULWW(chirp, chirp_Q16));
    }
    ar[d - 1] = toInt32(SKP_SMULWW(chirp, ar[d - 1]));
}
