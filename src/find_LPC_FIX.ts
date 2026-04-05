import { 
    SKP_RSHIFT, SKP_ADD32, SKP_Silk_sum_sqr_shift 
} from './macros';
import { SKP_Silk_burg_modified } from './burg_modified';
import { SKP_Silk_bwexpander_32 } from './bwexpander';
import { SKP_Silk_A2NLSF } from './A2NLSF';
import { SKP_Silk_interpolate } from './nlsf_vq';
import { SKP_Silk_NLSF2A_stable } from './nlsf2a_stable';
import { SKP_Silk_LPC_analysis_filter } from './lpc_analysis_filter';
import { MAX_LPC_ORDER, NB_SUBFR, MAX_FRAME_LENGTH } from './defines';
import {
    FIND_LPC_COND_FAC as FIND_LPC_COND_FAC_FLOAT,
    FIND_LPC_CHIRP as FIND_LPC_CHIRP_FLOAT,
} from './tuning_parameters';
import { SKP_FIX_CONST } from './macros';

const FIND_LPC_COND_FAC = SKP_FIX_CONST(FIND_LPC_COND_FAC_FLOAT, 32);
const FIND_LPC_CHIRP = SKP_FIX_CONST(FIND_LPC_CHIRP_FLOAT, 16);

export function SKP_Silk_find_LPC_FIX(
    NLSF_Q15: Int32Array | Int16Array,
    interpIndex: { val: number },
    prev_NLSFq_Q15: Int32Array | Int16Array,
    useInterpolatedNLSFs: number,
    LPC_order: number,
    x: Int16Array,
    x_offset: number,
    subfr_length: number
): void {
    let k: number;
    let a_Q16 = new Int32Array(MAX_LPC_ORDER);
    let isInterpLower: boolean, shift: number;
    let S = new Int16Array(MAX_LPC_ORDER);
    let res_nrg0 = { val: 0 }, res_nrg1 = { val: 0 };
    let rshift0 = { val: 0 }, rshift1 = { val: 0 };

    let a_tmp_Q16 = new Int32Array(MAX_LPC_ORDER);
    let res_nrg_interp: number, res_nrg: number, res_tmp_nrg: number;
    let res_nrg_interp_Q: number, res_nrg_Q: number, res_tmp_nrg_Q: number;
    let a_tmp_Q12 = new Int16Array(MAX_LPC_ORDER);
    let NLSF0_Q15 = new Int32Array(MAX_LPC_ORDER);
    let LPC_res = new Int16Array((MAX_FRAME_LENGTH + NB_SUBFR * MAX_LPC_ORDER) / 2);

    let res_nrg_val = { val: 0 };
    let res_nrg_Q_val = { val: 0 };
    let res_tmp_nrg_val = { val: 0 };
    let res_tmp_nrg_Q_val = { val: 0 };

    interpIndex.val = 4;

    SKP_Silk_burg_modified(res_nrg_val, res_nrg_Q_val, a_Q16, x, x_offset, subfr_length, NB_SUBFR, FIND_LPC_COND_FAC, LPC_order);
    res_nrg = res_nrg_val.val;
    res_nrg_Q = res_nrg_Q_val.val;

    SKP_Silk_bwexpander_32(a_Q16, LPC_order, FIND_LPC_CHIRP);

    if (useInterpolatedNLSFs === 1) {
        SKP_Silk_burg_modified(res_tmp_nrg_val, res_tmp_nrg_Q_val, a_tmp_Q16, x, x_offset + (NB_SUBFR >> 1) * subfr_length, 
            subfr_length, (NB_SUBFR >> 1), FIND_LPC_COND_FAC, LPC_order);
        res_tmp_nrg = res_tmp_nrg_val.val;
        res_tmp_nrg_Q = res_tmp_nrg_Q_val.val;

        SKP_Silk_bwexpander_32(a_tmp_Q16, LPC_order, FIND_LPC_CHIRP);


        shift = res_tmp_nrg_Q - res_nrg_Q;
        if (shift >= 0) {
            if (shift < 32) {
                res_nrg = (res_nrg - SKP_RSHIFT(res_tmp_nrg, shift)) | 0;
            }
        } else {
            res_nrg = (SKP_RSHIFT(res_nrg, -shift) - res_tmp_nrg) | 0;
            res_nrg_Q = res_tmp_nrg_Q;
        }

        SKP_Silk_A2NLSF(NLSF_Q15 as Int32Array, a_tmp_Q16, LPC_order);

        for (k = 3; k >= 0; k--) {
            SKP_Silk_interpolate(NLSF0_Q15, prev_NLSFq_Q15, NLSF_Q15, k, LPC_order);

            SKP_Silk_NLSF2A_stable(a_tmp_Q12, NLSF0_Q15, LPC_order);

            S.fill(0, 0, LPC_order);
            SKP_Silk_LPC_analysis_filter(x.subarray(x_offset), a_tmp_Q12, S, LPC_res, 2 * subfr_length, LPC_order);

            SKP_Silk_sum_sqr_shift(res_nrg0, rshift0, LPC_res.subarray(LPC_order), subfr_length - LPC_order);
            SKP_Silk_sum_sqr_shift(res_nrg1, rshift1, LPC_res.subarray(LPC_order + subfr_length), subfr_length - LPC_order);

            let nrg0 = res_nrg0.val;
            let nrg1 = res_nrg1.val;
            shift = rshift0.val - rshift1.val;
            if (shift >= 0) {
                nrg1 = SKP_RSHIFT(nrg1, shift);
                res_nrg_interp_Q = -rshift0.val;
            } else {
                nrg0 = SKP_RSHIFT(nrg0, -shift);
                res_nrg_interp_Q = -rshift1.val;
            }
            res_nrg_interp = SKP_ADD32(nrg0, nrg1);

            shift = res_nrg_interp_Q - res_nrg_Q;
            if (shift >= 0) {
                if (SKP_RSHIFT(res_nrg_interp, shift) < res_nrg) {
                    isInterpLower = true;
                } else {
                    isInterpLower = false;
                }
            } else {
                if (-shift < 32) {
                    if (res_nrg_interp < SKP_RSHIFT(res_nrg, -shift)) {
                        isInterpLower = true;
                    } else {
                        isInterpLower = false;
                    }
                } else {
                    isInterpLower = false;
                }
            }

            if (isInterpLower) {
                res_nrg = res_nrg_interp;
                res_nrg_Q = res_nrg_interp_Q;
                interpIndex.val = k;
            }
        }
    }

    if (interpIndex.val === 4) {
        SKP_Silk_A2NLSF(NLSF_Q15 as Int32Array, a_Q16, LPC_order);
    }
}
