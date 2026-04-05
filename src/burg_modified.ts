import { 
    SKP_Silk_sum_sqr_shift, SKP_Silk_CLZ32, SKP_LSHIFT32, SKP_RSHIFT32, SKP_SMMUL, 
    SKP_SMLAWB, SKP_SMLAWW, SKP_ADD_LSHIFT32, SKP_DIV32_varQ, SKP_MLA, SKP_RSHIFT_ROUND
} from './macros';
import { inner_prod16_aligned_64 } from './autocorr';
import { SKP_Silk_inner_prod_aligned } from './pitch_analysis_core';
import { MAX_LPC_ORDER } from './defines';

const QA = 25;
const N_BITS_HEAD_ROOM = 2;
const MIN_RSHIFTS = -16;
const MAX_RSHIFTS = 32 - QA;

export function SKP_Silk_burg_modified(
    res_nrg: { val: number },
    res_nrg_Q: { val: number },
    A_Q16: Int32Array | Int16Array,
    x: Int16Array,
    x_offset: number,
    subfr_length: number,
    nb_subfr: number,
    WhiteNoiseFrac_Q32: number,
    D: number
): void {
    let k: number, n: number, s: number, lz: number, rshifts: number, rshifts_extra: number;
    let C0: number, num: number, nrg: number, rc_Q31: number, Atmp_QA: number, Atmp1: number, tmp1: number, tmp2: number, x1: number, x2: number;

    let C_first_row = new Int32Array(MAX_LPC_ORDER);
    let C_last_row = new Int32Array(MAX_LPC_ORDER);
    let Af_QA = new Int32Array(MAX_LPC_ORDER);

    let CAf = new Int32Array(MAX_LPC_ORDER + 1);
    let CAb = new Int32Array(MAX_LPC_ORDER + 1);

    let C0_val = { val: 0 };
    let rshifts_val = { val: 0 };
    SKP_Silk_sum_sqr_shift(C0_val, rshifts_val, x.subarray(x_offset), nb_subfr * subfr_length);
    C0 = C0_val.val;
    rshifts = rshifts_val.val;

    if (rshifts > MAX_RSHIFTS) {
        C0 = SKP_LSHIFT32(C0, rshifts - MAX_RSHIFTS);
        rshifts = MAX_RSHIFTS;
    } else {
        lz = SKP_Silk_CLZ32(C0) - 1;
        rshifts_extra = N_BITS_HEAD_ROOM - lz;
        if (rshifts_extra > 0) {
            rshifts_extra = Math.min(rshifts_extra, MAX_RSHIFTS - rshifts);
            C0 = SKP_RSHIFT32(C0, rshifts_extra);
        } else {
            rshifts_extra = Math.max(rshifts_extra, MIN_RSHIFTS - rshifts);
            C0 = SKP_LSHIFT32(C0, -rshifts_extra);
        }
        rshifts += rshifts_extra;
    }

    if (rshifts > 0) {
        for (s = 0; s < nb_subfr; s++) {
            let x_ptr_offset = x_offset + s * subfr_length;
            for (n = 1; n < D + 1; n++) {
                let p64 = inner_prod16_aligned_64(x, x_ptr_offset, x, x_ptr_offset + n, subfr_length - n);
                C_first_row[n - 1] = (C_first_row[n - 1] + Number(BigInt(p64) >> BigInt(rshifts))) | 0;
            }
        }
    } else {
        for (s = 0; s < nb_subfr; s++) {
            let x_ptr_offset = x_offset + s * subfr_length;
            for (n = 1; n < D + 1; n++) {
                C_first_row[n - 1] = (C_first_row[n - 1] + SKP_LSHIFT32(SKP_Silk_inner_prod_aligned(x, x_ptr_offset, x, x_ptr_offset + n, subfr_length - n), -rshifts)) | 0;
            }
        }
    }
    C_last_row.set(C_first_row);

    CAb[0] = CAf[0] = (C0 + SKP_SMMUL(WhiteNoiseFrac_Q32, C0) + 1) | 0;

    for (n = 0; n < D; n++) {
        if (rshifts > -2) {
            for (s = 0; s < nb_subfr; s++) {
                let x_ptr_offset = x_offset + s * subfr_length;
                x1 = -SKP_LSHIFT32(x[x_ptr_offset + n], 16 - rshifts);
                x2 = -SKP_LSHIFT32(x[x_ptr_offset + subfr_length - n - 1], 16 - rshifts);
                tmp1 = SKP_LSHIFT32(x[x_ptr_offset + n], QA - 16);
                tmp2 = SKP_LSHIFT32(x[x_ptr_offset + subfr_length - n - 1], QA - 16);
                for (k = 0; k < n; k++) {
                    C_first_row[k] = SKP_SMLAWB(C_first_row[k], x1, x[x_ptr_offset + n - k - 1]);
                    C_last_row[k] = SKP_SMLAWB(C_last_row[k], x2, x[x_ptr_offset + subfr_length - n + k]);
                    Atmp_QA = Af_QA[k];
                    tmp1 = SKP_SMLAWB(tmp1, Atmp_QA, x[x_ptr_offset + n - k - 1]);
                    tmp2 = SKP_SMLAWB(tmp2, Atmp_QA, x[x_ptr_offset + subfr_length - n + k]);
                }
                tmp1 = SKP_LSHIFT32(-tmp1, 32 - QA - rshifts);
                tmp2 = SKP_LSHIFT32(-tmp2, 32 - QA - rshifts);
                for (k = 0; k <= n; k++) {
                    CAf[k] = SKP_SMLAWB(CAf[k], tmp1, x[x_ptr_offset + n - k]);
                    CAb[k] = SKP_SMLAWB(CAb[k], tmp2, x[x_ptr_offset + subfr_length - n + k - 1]);
                }
            }
        } else {
            for (s = 0; s < nb_subfr; s++) {
                let x_ptr_offset = x_offset + s * subfr_length;
                x1 = -SKP_LSHIFT32(x[x_ptr_offset + n], -rshifts);
                x2 = -SKP_LSHIFT32(x[x_ptr_offset + subfr_length - n - 1], -rshifts);
                tmp1 = SKP_LSHIFT32(x[x_ptr_offset + n], 17);
                tmp2 = SKP_LSHIFT32(x[x_ptr_offset + subfr_length - n - 1], 17);
                for (k = 0; k < n; k++) {
                    C_first_row[k] = SKP_MLA(C_first_row[k], x1, x[x_ptr_offset + n - k - 1]);
                    C_last_row[k] = SKP_MLA(C_last_row[k], x2, x[x_ptr_offset + subfr_length - n + k]);
                    Atmp1 = SKP_RSHIFT_ROUND(Af_QA[k], QA - 17);
                    tmp1 = SKP_MLA(tmp1, x[x_ptr_offset + n - k - 1], Atmp1);
                    tmp2 = SKP_MLA(tmp2, x[x_ptr_offset + subfr_length - n + k], Atmp1);
                }
                tmp1 = -tmp1 | 0;
                tmp2 = -tmp2 | 0;
                for (k = 0; k <= n; k++) {
                    CAf[k] = SKP_SMLAWW(CAf[k], tmp1, SKP_LSHIFT32(x[x_ptr_offset + n - k], -rshifts - 1));
                    CAb[k] = SKP_SMLAWW(CAb[k], tmp2, SKP_LSHIFT32(x[x_ptr_offset + subfr_length - n + k - 1], -rshifts - 1));
                }
            }
        }

        /* Calculate nominator and denominator for the next order reflection (parcor) coefficient */
        tmp1 = C_first_row[n]; // Q( -rshifts )
        tmp2 = C_last_row[n]; // Q( -rshifts )
        num = 0; // Q( -rshifts )
        nrg = (CAb[0] + CAf[0]) | 0; // Q( 1-rshifts )
        for (k = 0; k < n; k++) {
            Atmp_QA = Af_QA[k];
            lz = SKP_Silk_CLZ32(Math.abs(Atmp_QA)) - 1;
            lz = Math.min(32 - QA, lz);
            Atmp1 = SKP_LSHIFT32(Atmp_QA, lz); // Q( QA + lz )

            tmp1 = SKP_ADD_LSHIFT32(tmp1, SKP_SMMUL(C_last_row[n - k - 1], Atmp1), 32 - QA - lz); // Q( -rshifts )
            tmp2 = SKP_ADD_LSHIFT32(tmp2, SKP_SMMUL(C_first_row[n - k - 1], Atmp1), 32 - QA - lz); // Q( -rshifts )
            num = SKP_ADD_LSHIFT32(num, SKP_SMMUL(CAb[n - k], Atmp1), 32 - QA - lz); // Q( -rshifts )
            nrg = SKP_ADD_LSHIFT32(nrg, SKP_SMMUL((CAb[k + 1] + CAf[k + 1]) | 0, Atmp1), 32 - QA - lz); // Q( 1-rshifts )
        }
        CAf[n + 1] = tmp1; // Q( -rshifts )
        CAb[n + 1] = tmp2; // Q( -rshifts )
        num = (num + tmp2) | 0; // Q( -rshifts )
        num = SKP_LSHIFT32(-num | 0, 1); // Q( 1-rshifts )

        /* Calculate the next order reflection (parcor) coefficient */
        if (Math.abs(num) < nrg) {
            rc_Q31 = SKP_DIV32_varQ(num, nrg, 31);
        } else {
            /* Negative energy or ratio too high; set remaining coefficients to zero and exit loop */
            for (let i = n; i < D; i++) Af_QA[i] = 0;
            break;
        }

        for (k = 0; k < (n + 1) >> 1; k++) {
            tmp1 = Af_QA[k];
            tmp2 = Af_QA[n - k - 1];
            Af_QA[k] = SKP_ADD_LSHIFT32(tmp1, SKP_SMMUL(tmp2, rc_Q31), 1);
            Af_QA[n - k - 1] = SKP_ADD_LSHIFT32(tmp2, SKP_SMMUL(tmp1, rc_Q31), 1);
        }
        Af_QA[n] = SKP_RSHIFT32(rc_Q31, 31 - QA);

        for (k = 0; k <= n + 1; k++) {
            tmp1 = CAf[k];
            tmp2 = CAb[n - k + 1];
            CAf[k] = SKP_ADD_LSHIFT32(tmp1, SKP_SMMUL(tmp2, rc_Q31), 1);
            CAb[n - k + 1] = SKP_ADD_LSHIFT32(tmp2, SKP_SMMUL(tmp1, rc_Q31), 1);
        }
    }

    nrg = CAf[0];
    tmp1 = 1 << 16;
    for (k = 0; k < D; k++) {
        Atmp1 = SKP_RSHIFT_ROUND(Af_QA[k], QA - 16);
        nrg = SKP_SMLAWW(nrg, CAf[k + 1], Atmp1);
        tmp1 = SKP_SMLAWW(tmp1, Atmp1, Atmp1);
        A_Q16[k] = -Atmp1 | 0;
    }
    res_nrg.val = SKP_SMLAWW(nrg, SKP_SMMUL(WhiteNoiseFrac_Q32, C0), -tmp1);
    res_nrg_Q.val = -rshifts;
}
