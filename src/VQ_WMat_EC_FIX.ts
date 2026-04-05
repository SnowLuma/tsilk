import { 
    SKP_SMULBB, SKP_SMLAWB, SKP_SMLAWW, SKP_SMLAWT, SKP_SMULWB, SKP_SMULWT, SKP_LSHIFT
} from './macros';

/**
 * Entropy constrained MATRIX-weighted VQ, hard-coded to 5-element vectors, for a single input data vector
 */
export function SKP_Silk_VQ_WMat_EC_FIX(
    ind: { val: number },
    rate_dist_Q14: { val: number },
    in_Q14: Int16Array,
    in_offset: number,
    W_Q18: Int32Array,
    W_offset: number,
    cb_Q14: Int16Array,
    cb_offset: number,
    cl_Q6: Int16Array,
    mu_Q8: number,
    L: number
): void {
    let k: number;
    let diff_Q14_01: number, diff_Q14_23: number, diff_Q14_4: number;
    let sum1_Q14: number, sum2_Q16: number;

    rate_dist_Q14.val = 0x7FFFFFFF;
    let cb_row_Q14_idx = cb_offset;

    for (k = 0; k < L; k++) {
        // Pack pairs of int16 values per int32
        diff_Q14_01 = ((in_Q14[in_offset + 0] - cb_Q14[cb_row_Q14_idx + 0]) & 0xFFFF) | (((in_Q14[in_offset + 1] - cb_Q14[cb_row_Q14_idx + 1]) & 0xFFFF) << 16);
        diff_Q14_23 = ((in_Q14[in_offset + 2] - cb_Q14[cb_row_Q14_idx + 2]) & 0xFFFF) | (((in_Q14[in_offset + 3] - cb_Q14[cb_row_Q14_idx + 3]) & 0xFFFF) << 16);
        diff_Q14_4  = in_Q14[in_offset + 4] - cb_Q14[cb_row_Q14_idx + 4];

        sum1_Q14 = SKP_SMULBB(mu_Q8, cl_Q6[k]);

        // first row of W_Q18
        sum2_Q16 = SKP_SMULWT(W_Q18[W_offset + 1], diff_Q14_01);
        sum2_Q16 = SKP_SMLAWB(sum2_Q16, W_Q18[W_offset + 2], diff_Q14_23);
        sum2_Q16 = SKP_SMLAWT(sum2_Q16, W_Q18[W_offset + 3], diff_Q14_23);
        sum2_Q16 = SKP_SMLAWB(sum2_Q16, W_Q18[W_offset + 4], diff_Q14_4);
        sum2_Q16 = SKP_LSHIFT(sum2_Q16, 1);
        sum2_Q16 = SKP_SMLAWB(sum2_Q16, W_Q18[W_offset + 0], diff_Q14_01);
        sum1_Q14 = SKP_SMLAWB(sum1_Q14, sum2_Q16, diff_Q14_01);

        // second row of W_Q18
        sum2_Q16 = SKP_SMULWB(W_Q18[W_offset + 7], diff_Q14_23);
        sum2_Q16 = SKP_SMLAWT(sum2_Q16, W_Q18[W_offset + 8], diff_Q14_23);
        sum2_Q16 = SKP_SMLAWB(sum2_Q16, W_Q18[W_offset + 9], diff_Q14_4);
        sum2_Q16 = SKP_LSHIFT(sum2_Q16, 1);
        sum2_Q16 = SKP_SMLAWT(sum2_Q16, W_Q18[W_offset + 6], diff_Q14_01);
        sum1_Q14 = SKP_SMLAWT(sum1_Q14, sum2_Q16, diff_Q14_01);

        // third row of W_Q18
        sum2_Q16 = SKP_SMULWT(W_Q18[W_offset + 13], diff_Q14_23);
        sum2_Q16 = SKP_SMLAWB(sum2_Q16, W_Q18[W_offset + 14], diff_Q14_4);
        sum2_Q16 = SKP_LSHIFT(sum2_Q16, 1);
        sum2_Q16 = SKP_SMLAWB(sum2_Q16, W_Q18[W_offset + 12], diff_Q14_23);
        sum1_Q14 = SKP_SMLAWB(sum1_Q14, sum2_Q16, diff_Q14_23);

        // fourth row of W_Q18
        sum2_Q16 = SKP_SMULWB(W_Q18[W_offset + 19], diff_Q14_4);
        sum2_Q16 = SKP_LSHIFT(sum2_Q16, 1);
        sum2_Q16 = SKP_SMLAWT(sum2_Q16, W_Q18[W_offset + 18], diff_Q14_23);
        sum1_Q14 = SKP_SMLAWT(sum1_Q14, sum2_Q16, diff_Q14_23);

        // last row of W_Q18
        sum2_Q16 = SKP_SMULWB(W_Q18[W_offset + 24], diff_Q14_4);
        sum1_Q14 = SKP_SMLAWB(sum1_Q14, sum2_Q16, diff_Q14_4);

        if (sum1_Q14 < rate_dist_Q14.val) {
            rate_dist_Q14.val = sum1_Q14;
            ind.val = k;
        }

        cb_row_Q14_idx += 5; // LTP_ORDER is 5
    }
}
