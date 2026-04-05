import { SKP_SMULWW, toInt32 } from './macros';

export function SKP_Silk_bwexpander_32(ar: Int32Array, d: number, chirp_Q16: number): void {
    let chirp = chirp_Q16 | 0;
    for (let i = 0; i < d - 1; i++) {
        ar[i] = toInt32(SKP_SMULWW(chirp, ar[i] | 0));
        chirp = toInt32(SKP_SMULWW(chirp, chirp_Q16));
    }
    ar[d - 1] = toInt32(SKP_SMULWW(chirp, ar[d - 1] | 0));
}
