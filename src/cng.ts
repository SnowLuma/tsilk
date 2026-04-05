import { DecoderState, DecoderControl } from './structs';
import * as D from './defines';
import {
    SKP_DIV32_16,
    SKP_SMULWB,
    SKP_SMULWW,
    SKP_RSHIFT,
    SKP_RSHIFT_ROUND,
    SKP_SAT16,
    SKP_RAND,
    SKP_SMLAWB,
    SKP_SMLAWT,
    SKP_ADD_SAT32,
    SKP_LSHIFT_SAT32,
} from './macros';
import { NLSF2A_stable } from './nlsf2a_stable';

function CNG_exc(
    residual: Int16Array,
    exc_buf_Q10: Int32Array,
    gain_Q16: number,
    length: number,
    randSeed: { value: number },
): void {
    let excMask = D.CNG_BUF_MASK_MAX;
    while (excMask > length) {
        excMask = SKP_RSHIFT(excMask, 1);
    }

    let seed = randSeed.value | 0;
    for (let i = 0; i < length; i++) {
        seed = SKP_RAND(seed) | 0;
        const idx = (seed >>> 24) & excMask;
        residual[i] = SKP_SAT16(SKP_RSHIFT_ROUND(SKP_SMULWW(exc_buf_Q10[idx] | 0, gain_Q16 | 0), 10));
    }
    randSeed.value = seed | 0;
}

function LPC_synthesis_filter(
    input: Int16Array,
    A_Q12: Int16Array,
    gain_Q26: number,
    S: Int32Array,
    output: Int16Array,
    length: number,
    order: number,
): void {
    const orderHalf = order >> 1;
    const A_align = new Int32Array(orderHalf);
    for (let k = 0; k < orderHalf; k++) {
        const a0 = A_Q12[2 * k] | 0;
        const a1 = A_Q12[2 * k + 1] | 0;
        A_align[k] = ((a0 & 0xFFFF) | (a1 << 16)) | 0;
    }

    for (let k = 0; k < length; k++) {
        let SA = S[order - 1] | 0;
        let out32_Q10 = 0;

        for (let j = 0; j < orderHalf - 1; j++) {
            const idx = (2 * j + 1) | 0;
            const Atmp = A_align[j] | 0;
            const SB = S[order - 1 - idx] | 0;
            S[order - 1 - idx] = SA;
            out32_Q10 = SKP_SMLAWB(out32_Q10, SA, Atmp);
            out32_Q10 = SKP_SMLAWT(out32_Q10, SB, Atmp);
            SA = S[order - 2 - idx] | 0;
            S[order - 2 - idx] = SB;
        }

        const Atmp = A_align[orderHalf - 1] | 0;
        const SB = S[0] | 0;
        S[0] = SA;
        out32_Q10 = SKP_SMLAWB(out32_Q10, SA, Atmp);
        out32_Q10 = SKP_SMLAWT(out32_Q10, SB, Atmp);

        out32_Q10 = SKP_ADD_SAT32(out32_Q10, SKP_SMULWB(gain_Q26 | 0, input[k] | 0));
        const out32 = SKP_RSHIFT_ROUND(out32_Q10, 10);
        output[k] = SKP_SAT16(out32);
        S[order - 1] = SKP_LSHIFT_SAT32(out32_Q10, 4);
    }
}

function LPC_synthesis_order16(
    input: Int16Array,
    A_Q12: Int16Array,
    gain_Q26: number,
    S: Int32Array,
    output: Int16Array,
    length: number,
): void {
    const A_align = new Int32Array(8);
    for (let k = 0; k < 8; k++) {
        const a0 = A_Q12[2 * k] | 0;
        const a1 = A_Q12[2 * k + 1] | 0;
        A_align[k] = ((a0 & 0xFFFF) | (a1 << 16)) | 0;
    }

    for (let k = 0; k < length; k++) {
        let SA = S[15] | 0;
        let SB = S[14] | 0;
        S[14] = SA;
        let out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(0, SA, A_align[0]), SB, A_align[0]);
        SA = S[13] | 0;
        S[13] = SB;

        SB = S[12] | 0; S[12] = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[1]), SB, A_align[1]); SA = S[11] | 0; S[11] = SB;
        SB = S[10] | 0; S[10] = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[2]), SB, A_align[2]); SA = S[9] | 0;  S[9]  = SB;
        SB = S[8]  | 0; S[8]  = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[3]), SB, A_align[3]); SA = S[7] | 0;  S[7]  = SB;
        SB = S[6]  | 0; S[6]  = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[4]), SB, A_align[4]); SA = S[5] | 0;  S[5]  = SB;
        SB = S[4]  | 0; S[4]  = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[5]), SB, A_align[5]); SA = S[3] | 0;  S[3]  = SB;
        SB = S[2]  | 0; S[2]  = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[6]), SB, A_align[6]); SA = S[1] | 0;  S[1]  = SB;
        SB = S[0]  | 0; S[0]  = SA; out32_Q10 = SKP_SMLAWT(SKP_SMLAWB(out32_Q10, SA, A_align[7]), SB, A_align[7]);

        out32_Q10 = SKP_ADD_SAT32(out32_Q10, SKP_SMULWB(gain_Q26 | 0, input[k] | 0));
        const out32 = SKP_RSHIFT_ROUND(out32_Q10, 10);
        output[k] = SKP_SAT16(out32);
        S[15] = SKP_LSHIFT_SAT32(out32_Q10, 4);
    }
}

export function CNG_Reset(psDec: DecoderState): void {
    const step_Q15 = SKP_DIV32_16(32767, (psDec.LPC_order | 0) + 1);
    let acc = 0;
    for (let i = 0; i < (psDec.LPC_order | 0); i++) {
        acc = (acc + step_Q15) | 0;
        psDec.CNG_smth_NLSF_Q15[i] = acc;
    }
    psDec.CNG_smth_Gain_Q16 = 0;
    psDec.CNG_rand_seed = 3176576;
}

export function CNG(
    psDec: DecoderState,
    psDecCtrl: DecoderControl,
    signal: Int16Array,
    length: number,
): void {
    if ((psDec.fs_kHz | 0) !== (psDec.CNG_fs_kHz | 0)) {
        CNG_Reset(psDec);
        psDec.CNG_fs_kHz = psDec.fs_kHz | 0;
    }

    if ((psDec.lossCnt | 0) === 0 && (psDec.vadFlag | 0) === D.NO_VOICE_ACTIVITY) {
        for (let i = 0; i < (psDec.LPC_order | 0); i++) {
            psDec.CNG_smth_NLSF_Q15[i] = (psDec.CNG_smth_NLSF_Q15[i] +
                SKP_SMULWB((psDec.prevNLSF_Q15[i] - psDec.CNG_smth_NLSF_Q15[i]) | 0, D.CNG_NLSF_SMTH_Q16)) | 0;
        }

        let maxGain = 0;
        let subfr = 0;
        for (let i = 0; i < D.NB_SUBFR; i++) {
            const g = psDecCtrl.Gains_Q16[i] | 0;
            if (g > maxGain) {
                maxGain = g;
                subfr = i;
            }
        }

        const sfLen = psDec.subfr_length | 0;
        psDec.CNG_exc_buf_Q10.copyWithin(sfLen, 0, (D.NB_SUBFR - 1) * sfLen);
        psDec.CNG_exc_buf_Q10.set(psDec.exc_Q10.subarray(subfr * sfLen, subfr * sfLen + sfLen), 0);

        for (let i = 0; i < D.NB_SUBFR; i++) {
            psDec.CNG_smth_Gain_Q16 = (psDec.CNG_smth_Gain_Q16 +
                SKP_SMULWB((psDecCtrl.Gains_Q16[i] - psDec.CNG_smth_Gain_Q16) | 0, D.CNG_GAIN_SMTH_Q16)) | 0;
        }
    }

    if ((psDec.lossCnt | 0) > 0) {
        const cngSig = new Int16Array(D.MAX_FRAME_LENGTH);
        const randSeed = { value: psDec.CNG_rand_seed | 0 };
        CNG_exc(cngSig, psDec.CNG_exc_buf_Q10, psDec.CNG_smth_Gain_Q16 | 0, length | 0, randSeed);
        psDec.CNG_rand_seed = randSeed.value | 0;

        const LPC_buf = new Int16Array(D.MAX_LPC_ORDER);
        NLSF2A_stable(LPC_buf, psDec.CNG_smth_NLSF_Q15, psDec.LPC_order);

        if ((psDec.LPC_order | 0) === 16) {
            LPC_synthesis_order16(
                cngSig,
                LPC_buf,
                1 << 26,
                psDec.CNG_synth_state,
                cngSig,
                length,
            );
        } else {
            LPC_synthesis_filter(
                cngSig,
                LPC_buf,
                1 << 26,
                psDec.CNG_synth_state,
                cngSig,
                length,
                psDec.LPC_order,
            );
        }

        for (let i = 0; i < length; i++) {
            signal[i] = SKP_SAT16((signal[i] + cngSig[i]) | 0);
        }
    } else {
        psDec.CNG_synth_state.fill(0, 0, psDec.LPC_order | 0);
    }
}
