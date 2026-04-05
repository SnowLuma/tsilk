import { SKP_SMLAWW, SKP_LSHIFT } from './macros';
import { MAX_ORDER_LPC } from './defines';

/**
 * Step up function, converts reflection coefficients to prediction coefficients
 *
 * @param A_Q24 - Prediction coefficients [order] Q24
 * @param rc_Q16 - Reflection coefficients [order] Q16
 * @param order - Prediction order
 */
export function k2a_Q16(
    A_Q24: Int32Array,
    rc_Q16: Int32Array,
    order: number
): void {
    let k: number, n: number;
    let Atmp = new Int32Array(MAX_ORDER_LPC);

    for (k = 0; k < order; k++) {
        for (n = 0; n < k; n++) {
            Atmp[n] = A_Q24[n];
        }
        for (n = 0; n < k; n++) {
            A_Q24[n] = SKP_SMLAWW(A_Q24[n], Atmp[k - n - 1], rc_Q16[k]);
        }
        A_Q24[k] = -SKP_LSHIFT(rc_Q16[k], 8);
    }
}