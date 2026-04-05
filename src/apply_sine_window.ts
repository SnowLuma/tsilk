import { SKP_SMULWB as SMULWB, SKP_SMULWT as SMULWT, SKP_LSHIFT as LSHIFT, SKP_RSHIFT as RSHIFT, SKP_min as min } from './macros';

const freq_table_Q16 = new Int16Array([
    12111, 9804, 8235, 7100, 6239, 5565, 5022, 4575, 4202,
    3885, 3612, 3375, 3167, 2984, 2820, 2674, 2542, 2422,
    2313, 2214, 2123, 2038, 1961, 1889, 1822, 1760, 1702
]);

export function applySineWindow(
    px_win: Int16Array,
    px_win_offset: number,
    px: Int16Array,
    px_offset: number,
    win_type: number,
    length: number
): void {
    let k, f_Q16, c_Q16;
    let S0_Q16, S1_Q16;

    k = (length >> 2) - 4;
    f_Q16 = freq_table_Q16[k];

    c_Q16 = SMULWB(f_Q16, -f_Q16);

    if (win_type === 1) {
        S0_Q16 = 0;
        S1_Q16 = f_Q16 + (length >> 3);
    } else {
        S0_Q16 = (1 << 16);
        S1_Q16 = (1 << 16) + (c_Q16 >> 1) + (length >> 4);
    }

    for (k = 0; k < length; k += 4) {
        const px32_0 = ((px[px_offset + k] & 0xFFFF) | (px[px_offset + k + 1] << 16)) | 0;
        px_win[px_win_offset + k] = SMULWB(RSHIFT(S0_Q16 + S1_Q16, 1), px32_0);
        px_win[px_win_offset + k + 1] = SMULWT(S1_Q16, px32_0);
        
        S0_Q16 = SMULWB(S1_Q16, c_Q16) + LSHIFT(S1_Q16, 1) - S0_Q16 + 1;
        S0_Q16 = min(S0_Q16, 1 << 16);

        const px32_1 = ((px[px_offset + k + 2] & 0xFFFF) | (px[px_offset + k + 3] << 16)) | 0;
        px_win[px_win_offset + k + 2] = SMULWB(RSHIFT(S0_Q16 + S1_Q16, 1), px32_1);
        px_win[px_win_offset + k + 3] = SMULWT(S0_Q16, px32_1);
        
        S1_Q16 = SMULWB(S0_Q16, c_Q16) + LSHIFT(S0_Q16, 1) - S1_Q16;
        S1_Q16 = min(S1_Q16, 1 << 16);
    }
}
