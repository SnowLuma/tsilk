import { NB_SUBFR, LTP_ORDER } from './defines';
import { SKP_Silk_VQ_WMat_EC_FIX } from './VQ_WMat_EC_FIX';
import { SKP_ADD_POS_SAT32, SKP_MLA } from './macros';
import { 
    SKP_Silk_LTP_gain_BITS_Q6_ptrs, SKP_Silk_LTP_gain_middle_avg_RD_Q14,
    SKP_Silk_LTP_gain_vq_0_Q14, SKP_Silk_LTP_gain_vq_1_Q14, SKP_Silk_LTP_gain_vq_2_Q14 
} from './tables/index';

const SKP_Silk_LTP_vq_ptrs_Q14 = [
    SKP_Silk_LTP_gain_vq_0_Q14,
    SKP_Silk_LTP_gain_vq_1_Q14,
    SKP_Silk_LTP_gain_vq_2_Q14
];

const SKP_Silk_LTP_vq_sizes = [10, 20, 40];

export function SKP_Silk_quant_LTP_gains_FIX(
    B_Q14: Int16Array,
    cbk_index: Int32Array,
    periodicity_index: { val: number },
    W_Q18: Int32Array,
    mu_Q8: number,
    lowComplexity: number
): void {
    let j: number, k: number;
    let cbk_size: number;
    let cl_ptr: Int16Array;
    let cbk_ptr_Q14: Int16Array;
    
    let temp_idx = new Int32Array(NB_SUBFR);
    let rate_dist_subfr = { val: 0 };
    let temp_idx_val = { val: 0 };
    let rate_dist: number, min_rate_dist: number;

    min_rate_dist = 0x7FFFFFFF;

    for (k = 0; k < 3; k++) {
        cl_ptr = SKP_Silk_LTP_gain_BITS_Q6_ptrs[k];
        cbk_ptr_Q14 = SKP_Silk_LTP_vq_ptrs_Q14[k];
        cbk_size = SKP_Silk_LTP_vq_sizes[k];

        let W_Q18_ptr = 0;
        let b_Q14_ptr = 0;

        rate_dist = 0;
        for (j = 0; j < NB_SUBFR; j++) {
            SKP_Silk_VQ_WMat_EC_FIX(
                temp_idx_val,
                rate_dist_subfr,
                B_Q14, b_Q14_ptr,
                W_Q18, W_Q18_ptr,
                cbk_ptr_Q14, 0,
                cl_ptr,
                mu_Q8,
                cbk_size
            );
            temp_idx[j] = temp_idx_val.val;

            rate_dist = SKP_ADD_POS_SAT32(rate_dist, rate_dist_subfr.val);

            b_Q14_ptr += LTP_ORDER;
            W_Q18_ptr += LTP_ORDER * LTP_ORDER;
        }

        rate_dist = Math.min(0x7FFFFFFF - 1, rate_dist);

        if (rate_dist < min_rate_dist) {
            min_rate_dist = rate_dist;
            for (let i = 0; i < NB_SUBFR; i++) cbk_index[i] = temp_idx[i];
            periodicity_index.val = k;
        }

        if (lowComplexity && (rate_dist < SKP_Silk_LTP_gain_middle_avg_RD_Q14)) {
            break;
        }
    }

    cbk_ptr_Q14 = SKP_Silk_LTP_vq_ptrs_Q14[periodicity_index.val];
    for (j = 0; j < NB_SUBFR; j++) {
        for (k = 0; k < LTP_ORDER; k++) {
            B_Q14[j * LTP_ORDER + k] = cbk_ptr_Q14[SKP_MLA(k, cbk_index[j], LTP_ORDER)];
        }
    }
}
