import { SKP_DIV32_varQ, SKP_SMMUL, SKP_LSHIFT, SKP_RSHIFT_ROUND } from './macros';
import { MAX_ORDER_LPC } from './defines';

/**
 * Calculates the reflection coefficients from the correlation sequence
 * using extra precision (Q16).
 *
 * @param rc_Q16 - Reflection coefficients [order] Q16
 * @param c - Correlations [order+1]
 * @param order - Prediction order
 * @returns Residual energy
 */
export function schur64(
    rc_Q16: Int32Array,
    c: Int32Array,
    order: number
): number {
    let k: number, n: number;
    const C = new Int32Array((MAX_ORDER_LPC + 1) * 2);
    let Ctmp1_Q30: number, Ctmp2_Q30: number, rc_tmp_Q31: number;

    /* Check for invalid input */
    if (c[0] <= 0) {
        rc_Q16.fill(0, 0, order);
        return 0;
    }

    for (k = 0; k < order + 1; k++) {
        C[k * 2] = C[k * 2 + 1] = c[k];
    }

    for (k = 0; k < order; k++) {
        /* Get reflection coefficient: divide two Q30 values and get result in Q31 */
        rc_tmp_Q31 = SKP_DIV32_varQ(-C[(k + 1) * 2], C[1], 31);

        /* Save the output */
        rc_Q16[k] = SKP_RSHIFT_ROUND(rc_tmp_Q31, 15);

        /* Update correlations */
        for (n = 0; n < order - k; n++) {
            Ctmp1_Q30 = C[(n + k + 1) * 2];
            Ctmp2_Q30 = C[n * 2 + 1];

            /* Multiply and add the highest int32 */
            C[(n + k + 1) * 2] = (Ctmp1_Q30 + SKP_SMMUL(SKP_LSHIFT(Ctmp2_Q30, 1), rc_tmp_Q31)) | 0;
            C[n * 2 + 1] = (Ctmp2_Q30 + SKP_SMMUL(SKP_LSHIFT(Ctmp1_Q30, 1), rc_tmp_Q31)) | 0;
        }
    }

    return C[1];
}