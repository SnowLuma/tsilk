import { SKP_LSHIFT as LSHIFT, SKP_SMLAWB as SMLAWB } from './macros';
import { MAX_ORDER_LPC } from './defines';

export function k2a(
    A_Q24: Int32Array,
    rc_Q15: Int16Array,
    order: number
): void {
    let k: number, n: number;
    let Atmp = new Int32Array(MAX_ORDER_LPC);

    for (k = 0; k < order; k++) {
        for (n = 0; n < k; n++) {
            Atmp[n] = A_Q24[n];
        }
        for (n = 0; n < k; n++) {
            A_Q24[n] = SMLAWB(A_Q24[n], LSHIFT(Atmp[k - n - 1], 1), rc_Q15[k]);
        }
        A_Q24[k] = -LSHIFT(rc_Q15[k], 9);
    }
}
