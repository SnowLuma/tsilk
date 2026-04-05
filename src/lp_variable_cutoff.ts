import { LPState } from './structs';
import { 
    SKP_Silk_Transition_LP_A_Q28, 
    SKP_Silk_Transition_LP_B_Q28 
} from './tables/tables_other';
import { 
    SKP_SMLAWB as SMLAWB,
    SKP_RSHIFT as RSHIFT,
    SKP_SAT16 as SAT16,
    SKP_LSHIFT as LSHIFT,
    SKP_DIV32_16 as DIV32_16,
    biquad_alt
} from './macros';

const TRANSITION_NB = 3;
const TRANSITION_NA = 2;
const TRANSITION_INT_NUM = 5;
const FRAME_LENGTH_MS = 20;

const TRANSITION_TIME_UP_MS = 5120;
const TRANSITION_TIME_DOWN_MS = 2560;

const TRANSITION_FRAMES_UP = Math.floor(TRANSITION_TIME_UP_MS / FRAME_LENGTH_MS); // 256
const TRANSITION_FRAMES_DOWN = Math.floor(TRANSITION_TIME_DOWN_MS / FRAME_LENGTH_MS); // 128
const TRANSITION_INT_STEPS_UP = Math.floor(TRANSITION_FRAMES_UP / (TRANSITION_INT_NUM - 1)); // 64
const TRANSITION_INT_STEPS_DOWN = Math.floor(TRANSITION_FRAMES_DOWN / (TRANSITION_INT_NUM - 1)); // 32

function LP_interpolate_filter_taps(
    B_Q28: Int32Array,
    A_Q28: Int32Array,
    ind: number,
    fac_Q16: number
): void {
    if (ind < TRANSITION_INT_NUM - 1) {
        if (fac_Q16 > 0) {
            if (fac_Q16 === SAT16(fac_Q16)) {
                for (let nb = 0; nb < TRANSITION_NB; nb++) {
                    B_Q28[nb] = SMLAWB(
                        SKP_Silk_Transition_LP_B_Q28[ind][nb],
                        SKP_Silk_Transition_LP_B_Q28[ind + 1][nb] - SKP_Silk_Transition_LP_B_Q28[ind][nb],
                        fac_Q16
                    );
                }
                for (let na = 0; na < TRANSITION_NA; na++) {
                    A_Q28[na] = SMLAWB(
                        SKP_Silk_Transition_LP_A_Q28[ind][na],
                        SKP_Silk_Transition_LP_A_Q28[ind + 1][na] - SKP_Silk_Transition_LP_A_Q28[ind][na],
                        fac_Q16
                    );
                }
            } else if (fac_Q16 === (1 << 15)) {
                for (let nb = 0; nb < TRANSITION_NB; nb++) {
                    B_Q28[nb] = RSHIFT(
                        SKP_Silk_Transition_LP_B_Q28[ind][nb] + SKP_Silk_Transition_LP_B_Q28[ind + 1][nb],
                        1
                    );
                }
                for (let na = 0; na < TRANSITION_NA; na++) {
                    A_Q28[na] = RSHIFT(
                        SKP_Silk_Transition_LP_A_Q28[ind][na] + SKP_Silk_Transition_LP_A_Q28[ind + 1][na],
                        1
                    );
                }
            } else {
                for (let nb = 0; nb < TRANSITION_NB; nb++) {
                    B_Q28[nb] = SMLAWB(
                        SKP_Silk_Transition_LP_B_Q28[ind + 1][nb],
                        SKP_Silk_Transition_LP_B_Q28[ind][nb] - SKP_Silk_Transition_LP_B_Q28[ind + 1][nb],
                        (1 << 16) - fac_Q16
                    );
                }
                for (let na = 0; na < TRANSITION_NA; na++) {
                    A_Q28[na] = SMLAWB(
                        SKP_Silk_Transition_LP_A_Q28[ind + 1][na],
                        SKP_Silk_Transition_LP_A_Q28[ind][na] - SKP_Silk_Transition_LP_A_Q28[ind + 1][na],
                        (1 << 16) - fac_Q16
                    );
                }
            }
        } else {
            B_Q28.set(SKP_Silk_Transition_LP_B_Q28[ind]);
            A_Q28.set(SKP_Silk_Transition_LP_A_Q28[ind]);
        }
    } else {
        B_Q28.set(SKP_Silk_Transition_LP_B_Q28[TRANSITION_INT_NUM - 1]);
        A_Q28.set(SKP_Silk_Transition_LP_A_Q28[TRANSITION_INT_NUM - 1]);
    }
}

export function LP_variable_cutoff(
    psLP: LPState,
    outData: Int16Array,
    outOffset: number,
    inData: Int16Array,
    inOffset: number,
    frame_length: number
): void {
    let B_Q28 = new Int32Array(TRANSITION_NB);
    let A_Q28 = new Int32Array(TRANSITION_NA);
    let fac_Q16 = 0;
    let ind = 0;

    if (psLP.transition_frame_no > 0) {
        if (psLP.mode === 0) {
            if (psLP.transition_frame_no < TRANSITION_FRAMES_DOWN) {
                fac_Q16 = LSHIFT(psLP.transition_frame_no, 16 - 5);
                ind = RSHIFT(fac_Q16, 16);
                fac_Q16 -= LSHIFT(ind, 16);

                LP_interpolate_filter_taps(B_Q28, A_Q28, ind, fac_Q16);
                psLP.transition_frame_no++;
            } else {
                LP_interpolate_filter_taps(B_Q28, A_Q28, TRANSITION_INT_NUM - 1, 0);
            }
        } else {
            if (psLP.transition_frame_no < TRANSITION_FRAMES_UP) {
                fac_Q16 = LSHIFT(TRANSITION_FRAMES_UP - psLP.transition_frame_no, 16 - 6);
                ind = RSHIFT(fac_Q16, 16);
                fac_Q16 -= LSHIFT(ind, 16);

                LP_interpolate_filter_taps(B_Q28, A_Q28, ind, fac_Q16);
                psLP.transition_frame_no++;
            } else {
                LP_interpolate_filter_taps(B_Q28, A_Q28, 0, 0);
            }
        }
    }

    if (psLP.transition_frame_no > 0) {
        if (!psLP.In_LP_State) psLP.In_LP_State = new Int32Array(2);
        
        let inFrame = new Int16Array(inData.buffer, inData.byteOffset + inOffset * 2, frame_length);
        let outFrame = new Int16Array(outData.buffer, outData.byteOffset + outOffset * 2, frame_length);

        biquad_alt(inFrame, 0, B_Q28, A_Q28, psLP.In_LP_State, outFrame, 0, frame_length);
    } else {
        for (let i = 0; i < frame_length; i++) {
            outData[outOffset + i] = inData[inOffset + i];
        }
    }
}
