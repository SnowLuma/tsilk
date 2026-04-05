import { NB_SUBFR, LTP_ORDER } from './defines';
import { 
    SKP_Silk_sum_sqr_shift, SKP_Silk_CLZ32, SKP_RSHIFT_ROUND, SKP_RSHIFT, SKP_SMLAWB, 
    SKP_LSHIFT_SAT32, SKP_SMULWB, SKP_DIV32, SKP_LSHIFT, SKP_ADD32, SKP_DIV32_varQ, 
    SKP_SMULBB, SKP_SAT16, SKP_MUL, SKP_SMULWW,
    SKP_SUB_SAT32, SKP_max_16
} from './macros';
import { lin2log } from './macros';
import { SKP_Silk_corrMatrix_FIX, SKP_Silk_corrVector_FIX } from './corrMatrix_FIX';
import { SKP_Silk_regularize_correlations_FIX, SKP_Silk_solve_LDL_FIX } from './solve_LDL_FIX';
import { SKP_Silk_residual_energy16_covar_FIX } from './residual_energy_FIX';

const LTP_CORRS_HEAD_ROOM = 2;
const LTP_DAMPING_DIV3_Q16 = 218; // 0.01/3 * 65536
const LTP_SMOOTHING_Q26 = 6710886; // 0.1 * 67108864

function SKP_LIMIT_32(x: number, low: number, high: number): number {
    return x < low ? low : (x > high ? high : x);
}

function SKP_max_32(a: number, b: number): number { return a > b ? a : b; }
function SKP_min_int(a: number, b: number): number { return a < b ? a : b; }
function SKP_max_int(a: number, b: number): number { return a > b ? a : b; }

function SKP_Silk_fit_LTP(LTP_coefs_Q16: Int32Array, LTP_coefs_Q14: Int16Array, offset1: number, offset2: number): void {
    for (let i = 0; i < LTP_ORDER; i++) {
        LTP_coefs_Q14[offset2 + i] = SKP_SAT16(SKP_RSHIFT_ROUND(LTP_coefs_Q16[offset1 + i], 2));
    }
}

function SKP_Silk_scale_vector32_Q26_lshift_18(data1: Int32Array, data1_offset: number, gain_Q26: number, data_length: number): void {
    for (let i = 0; i < data_length; i++) {
        data1[data1_offset + i] = Number((BigInt(data1[data1_offset + i]) * BigInt(gain_Q26)) >> 8n) | 0;
    }
}

export function SKP_Silk_find_LTP_FIX(
    b_Q14: Int16Array,
    WLTP: Int32Array,
    LTPredCodGain_Q7: { val: number } | null,
    r_first: Int16Array,
    r_last: Int16Array,
    lag: Int32Array | number[],
    Wght_Q15: Int32Array | number[],
    subfr_length: number,
    mem_offset: number,
    corr_rshifts: Int32Array | number[]
): void {
    let i: number, k: number, lshift: number;
    let b_Q14_ptr = 0;
    
    let regu: number;
    let WLTP_ptr = 0;
    let b_Q16 = new Int32Array(LTP_ORDER);
    let delta_b_Q14 = new Int32Array(LTP_ORDER);
    let d_Q14 = new Int32Array(NB_SUBFR);
    let nrg = new Int32Array(NB_SUBFR);
    let g_Q26: number;
    let w = new Int32Array(NB_SUBFR);
    let WLTP_max: number, max_abs_d_Q14: number, max_w_bits: number;

    let temp32: number, denom32: number;
    let extra_shifts: number;
    let rr_shifts: number, maxRshifts: number, maxRshifts_wxtra: number, LZs: number;
    let LPC_res_nrg: number, LPC_LTP_res_nrg: number, div_Q16: number;
    let Rr = new Int32Array(LTP_ORDER);
    let rr = new Int32Array(NB_SUBFR);
    let wd: number, m_Q12: number;

    let rr_shifts_val = { val: 0 };
    let corr_rshifts_val = { val: 0 };
    let nrg_val = { val: 0 };

    for (k = 0; k < NB_SUBFR; k++) {
        let current_r = k >= (NB_SUBFR >> 1) ? r_last : r_first;
        let current_r_offset = mem_offset + (k % (NB_SUBFR >> 1)) * subfr_length;
        let lag_offset = current_r_offset - lag[k] - Math.floor(LTP_ORDER / 2);

        let energy_val = { val: 0 };
        let shift_val = { val: 0 };
        let slice = current_r.subarray(current_r_offset, current_r_offset + subfr_length);
        SKP_Silk_sum_sqr_shift(energy_val, shift_val, slice, subfr_length);
        rr[k] = energy_val.val;
        rr_shifts = shift_val.val;

        LZs = SKP_Silk_CLZ32(rr[k]);
        if (LZs < LTP_CORRS_HEAD_ROOM) {
            rr[k] = SKP_RSHIFT_ROUND(rr[k], LTP_CORRS_HEAD_ROOM - LZs);
            rr_shifts += (LTP_CORRS_HEAD_ROOM - LZs);
        }
        corr_rshifts[k] = rr_shifts;
        corr_rshifts_val.val = corr_rshifts[k];

        SKP_Silk_corrMatrix_FIX(current_r, lag_offset, subfr_length, LTP_ORDER, LTP_CORRS_HEAD_ROOM, WLTP.subarray(WLTP_ptr), corr_rshifts_val);
        corr_rshifts[k] = corr_rshifts_val.val;

        SKP_Silk_corrVector_FIX(current_r, lag_offset, current_r, current_r_offset, subfr_length, LTP_ORDER, Rr, corr_rshifts[k]);

        if (corr_rshifts[k] > rr_shifts) {
            rr[k] = SKP_RSHIFT(rr[k], corr_rshifts[k] - rr_shifts);
        }

        regu = 1;
        regu = SKP_SMLAWB(regu, rr[k], LTP_DAMPING_DIV3_Q16);
        regu = SKP_SMLAWB(regu, WLTP[WLTP_ptr + 0], LTP_DAMPING_DIV3_Q16);
        regu = SKP_SMLAWB(regu, WLTP[WLTP_ptr + (LTP_ORDER - 1) * LTP_ORDER + (LTP_ORDER - 1)], LTP_DAMPING_DIV3_Q16);
        
        let rR_obj = { val: rr[k] };
        SKP_Silk_regularize_correlations_FIX(WLTP.subarray(WLTP_ptr), rR_obj, 0, regu, LTP_ORDER);
        rr[k] = rR_obj.val;

        SKP_Silk_solve_LDL_FIX(WLTP.subarray(WLTP_ptr), LTP_ORDER, Rr, b_Q16);

        SKP_Silk_fit_LTP(b_Q16, b_Q14, 0, b_Q14_ptr);

        let energy_returned = SKP_Silk_residual_energy16_covar_FIX(b_Q14.subarray(b_Q14_ptr), WLTP.subarray(WLTP_ptr), Rr, rr[k], LTP_ORDER, 14);
        nrg[k] = energy_returned;

        extra_shifts = SKP_min_int(corr_rshifts[k], LTP_CORRS_HEAD_ROOM);
        denom32 = SKP_LSHIFT_SAT32(SKP_SMULWB(nrg[k], Wght_Q15[k]), 1 + extra_shifts) +
            SKP_RSHIFT(SKP_SMULWB(subfr_length, 655), corr_rshifts[k] - extra_shifts);
        denom32 = Math.max(denom32, 1);
        temp32 = SKP_DIV32(SKP_LSHIFT(Wght_Q15[k], 16), denom32);
        temp32 = SKP_RSHIFT(temp32, 31 + corr_rshifts[k] - extra_shifts - 26);

        WLTP_max = 0;
        for (i = 0; i < LTP_ORDER * LTP_ORDER; i++) {
            WLTP_max = Math.max(WLTP[WLTP_ptr + i], WLTP_max);
        }
        lshift = SKP_Silk_CLZ32(WLTP_max) - 1 - 3;
        if (26 - 18 + lshift < 31) {
            temp32 = Math.min(temp32, SKP_LSHIFT(1, 26 - 18 + lshift));
        }

        SKP_Silk_scale_vector32_Q26_lshift_18(WLTP, WLTP_ptr, temp32, LTP_ORDER * LTP_ORDER);

        let idx = (LTP_ORDER >> 1) * LTP_ORDER + (LTP_ORDER >> 1);
        w[k] = WLTP[WLTP_ptr + idx];

        b_Q14_ptr += LTP_ORDER;
        WLTP_ptr += LTP_ORDER * LTP_ORDER;
    }

    maxRshifts = 0;
    for (k = 0; k < NB_SUBFR; k++) {
        maxRshifts = SKP_max_int(corr_rshifts[k], maxRshifts);
    }

    if (LTPredCodGain_Q7 !== null) {
        LPC_LTP_res_nrg = 0;
        LPC_res_nrg = 0;
        for (k = 0; k < NB_SUBFR; k++) {
            LPC_res_nrg = SKP_ADD32(LPC_res_nrg, SKP_RSHIFT(SKP_ADD32(SKP_SMULWB(rr[k], Wght_Q15[k]), 1), 1 + (maxRshifts - corr_rshifts[k])));
            LPC_LTP_res_nrg = SKP_ADD32(LPC_LTP_res_nrg, SKP_RSHIFT(SKP_ADD32(SKP_SMULWB(nrg[k], Wght_Q15[k]), 1), 1 + (maxRshifts - corr_rshifts[k])));
        }
        LPC_LTP_res_nrg = Math.max(LPC_LTP_res_nrg, 1);

        div_Q16 = SKP_DIV32_varQ(LPC_res_nrg, LPC_LTP_res_nrg, 16);

        LTPredCodGain_Q7.val = SKP_SMULBB(3, lin2log(div_Q16) - (16 << 7));
    }

    b_Q14_ptr = 0;
    for (k = 0; k < NB_SUBFR; k++) {
        d_Q14[k] = 0;
        for (i = 0; i < LTP_ORDER; i++) {
            d_Q14[k] += b_Q14[b_Q14_ptr + i];
        }
        b_Q14_ptr += LTP_ORDER;
    }

    max_abs_d_Q14 = 0;
    max_w_bits = 0;
    for (k = 0; k < NB_SUBFR; k++) {
        max_abs_d_Q14 = SKP_max_32(max_abs_d_Q14, Math.abs(d_Q14[k]));
        max_w_bits = SKP_max_32(max_w_bits, 32 - SKP_Silk_CLZ32(w[k]) + corr_rshifts[k] - maxRshifts);
    }

    extra_shifts = max_w_bits + 32 - SKP_Silk_CLZ32(max_abs_d_Q14) - 14;
    extra_shifts -= (32 - 1 - 2 + maxRshifts);
    extra_shifts = SKP_max_int(extra_shifts, 0);

    maxRshifts_wxtra = maxRshifts + extra_shifts;

    temp32 = SKP_RSHIFT(262, maxRshifts + extra_shifts) + 1;
    wd = 0;
    for (k = 0; k < NB_SUBFR; k++) {
        temp32 = SKP_ADD32(temp32, SKP_RSHIFT(w[k], maxRshifts_wxtra - corr_rshifts[k]));
        wd = SKP_ADD32(wd, SKP_LSHIFT(SKP_SMULWW(SKP_RSHIFT(w[k], maxRshifts_wxtra - corr_rshifts[k]), d_Q14[k]), 2));
    }
    m_Q12 = SKP_DIV32_varQ(wd, temp32, 12);

    b_Q14_ptr = 0;
    for (k = 0; k < NB_SUBFR; k++) {
        if (2 - corr_rshifts[k] > 0) {
            temp32 = SKP_RSHIFT(w[k], 2 - corr_rshifts[k]);
        } else {
            temp32 = SKP_LSHIFT_SAT32(w[k], corr_rshifts[k] - 2);
        }

        g_Q26 = SKP_MUL(
            SKP_DIV32(6710886, SKP_RSHIFT(6710886, 10) + temp32),
            SKP_LSHIFT_SAT32(SKP_SUB_SAT32(m_Q12, SKP_RSHIFT(d_Q14[k], 2)), 4)
        );

        temp32 = 0;
        for (i = 0; i < LTP_ORDER; i++) {
            delta_b_Q14[i] = SKP_max_16(b_Q14[b_Q14_ptr + i], 1638);
            temp32 += delta_b_Q14[i];
        }
        temp32 = SKP_DIV32(g_Q26, temp32);
        for (i = 0; i < LTP_ORDER; i++) {
            b_Q14[b_Q14_ptr + i] = SKP_LIMIT_32(b_Q14[b_Q14_ptr + i] + SKP_SMULWB(SKP_LSHIFT_SAT32(temp32, 4), delta_b_Q14[i]), -16000, 28000);
        }
        b_Q14_ptr += LTP_ORDER;
    }
    console.log(`[smooth END] b_Q14[0..4]=[${b_Q14[0]},${b_Q14[1]},${b_Q14[2]},${b_Q14[3]},${b_Q14[4]}]`);
}
