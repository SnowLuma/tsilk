/**
 * Simple resampler for sample rate conversion
 * Supports SILK internal rates (8/12/16/24 kHz) to API rates (8/12/16/24/32/44.1/48 kHz)
 */
import {
    SKP_Silk_resampler_private_AR2,
} from './resampler_down';
import { SKP_ADD32, SKP_RSHIFT32, SKP_RSHIFT_ROUND, SKP_SAT16, SKP_SMLAWB, SKP_SMULWB, SKP_SUB32 } from './macros';

const RESAMPLER_3_4_COEFS = new Int16Array([
    -18249, -12532,
    -97, 284, -495, 309, 10268, 20317,
    -94, 156, -48, -720, 5984, 18278,
    -45, -4, 237, -847, 2540, 14662,
]);

const RESAMPLER_2_3_COEFS = new Int16Array([
    -11891, -12486,
    20, 211, -657, 688, 8423, 15911,
    -44, 197, -152, -653, 3855, 13015,
]);

const RESAMPLER_1_2_COEFS = new Int16Array([
    2415, -13101,
    158, -295, -400, 1265, 4832, 7968,
]);

const RESAMPLER_1_3_COEFS = new Int16Array([
    16643, -14000,
    -331, 19, 581, 1421, 2290, 2845,
]);

function resampleUp2Hq(input: Int16Array): Int16Array {
    // Mirrors SKP_Silk_resampler_private_up2_HQ.c
    const up2_hq_0 = [4280, 33727 - 65536];
    const up2_hq_1 = [16295, 54015 - 65536];
    const notch = [7864, -3604, 13107, 28508];

    const S = new Int32Array(6);
    const out = new Int16Array(input.length * 2);

    for (let k = 0; k < input.length; k++) {
        const in32 = input[k] << 10;

        let Y = SKP_SUB32(in32, S[0]);
        let X = SKP_SMULWB(Y, up2_hq_0[0]);
        let out32_1 = SKP_ADD32(S[0], X);
        S[0] = SKP_ADD32(in32, X);

        Y = SKP_SUB32(out32_1, S[1]);
        X = SKP_SMLAWB(Y, Y, up2_hq_0[1]);
        let out32_2 = SKP_ADD32(S[1], X);
        S[1] = SKP_ADD32(out32_1, X);

        out32_2 = SKP_SMLAWB(out32_2, S[5], notch[2]);
        out32_2 = SKP_SMLAWB(out32_2, S[4], notch[1]);
        out32_1 = SKP_SMLAWB(out32_2, S[4], notch[0]);
        S[5] = SKP_SUB32(out32_2, S[5]);

        out[2 * k] = SKP_SAT16(SKP_RSHIFT32(SKP_SMLAWB(256, out32_1, notch[3]), 9));

        Y = SKP_SUB32(in32, S[2]);
        X = SKP_SMULWB(Y, up2_hq_1[0]);
        out32_1 = SKP_ADD32(S[2], X);
        S[2] = SKP_ADD32(in32, X);

        Y = SKP_SUB32(out32_1, S[3]);
        X = SKP_SMLAWB(Y, Y, up2_hq_1[1]);
        out32_2 = SKP_ADD32(S[3], X);
        S[3] = SKP_ADD32(out32_1, X);

        out32_2 = SKP_SMLAWB(out32_2, S[4], notch[2]);
        out32_2 = SKP_SMLAWB(out32_2, S[5], notch[1]);
        out32_1 = SKP_SMLAWB(out32_2, S[5], notch[0]);
        S[4] = SKP_SUB32(out32_2, S[4]);

        out[2 * k + 1] = SKP_SAT16(SKP_RSHIFT32(SKP_SMLAWB(256, out32_1, notch[3]), 9));
    }

    return out;
}

export function resampleUp2HqStateful(input: Int16Array, state: Int32Array): Int16Array {
    const up2_hq_0 = [4280, 33727 - 65536];
    const up2_hq_1 = [16295, 54015 - 65536];
    const notch = [7864, -3604, 13107, 28508];

    const S = state;
    const out = new Int16Array(input.length * 2);

    for (let k = 0; k < input.length; k++) {
        const in32 = input[k] << 10;

        let Y = SKP_SUB32(in32, S[0]);
        let X = SKP_SMULWB(Y, up2_hq_0[0]);
        let out32_1 = SKP_ADD32(S[0], X);
        S[0] = SKP_ADD32(in32, X);

        Y = SKP_SUB32(out32_1, S[1]);
        X = SKP_SMLAWB(Y, Y, up2_hq_0[1]);
        let out32_2 = SKP_ADD32(S[1], X);
        S[1] = SKP_ADD32(out32_1, X);

        out32_2 = SKP_SMLAWB(out32_2, S[5], notch[2]);
        out32_2 = SKP_SMLAWB(out32_2, S[4], notch[1]);
        out32_1 = SKP_SMLAWB(out32_2, S[4], notch[0]);
        S[5] = SKP_SUB32(out32_2, S[5]);

        out[2 * k] = SKP_SAT16(SKP_RSHIFT32(SKP_SMLAWB(256, out32_1, notch[3]), 9));

        Y = SKP_SUB32(in32, S[2]);
        X = SKP_SMULWB(Y, up2_hq_1[0]);
        out32_1 = SKP_ADD32(S[2], X);
        S[2] = SKP_ADD32(in32, X);

        Y = SKP_SUB32(out32_1, S[3]);
        X = SKP_SMLAWB(Y, Y, up2_hq_1[1]);
        out32_2 = SKP_ADD32(S[3], X);
        S[3] = SKP_ADD32(out32_1, X);

        out32_2 = SKP_SMLAWB(out32_2, S[4], notch[2]);
        out32_2 = SKP_SMLAWB(out32_2, S[5], notch[1]);
        out32_1 = SKP_SMLAWB(out32_2, S[5], notch[0]);
        S[4] = SKP_SUB32(out32_2, S[4]);

        out[2 * k + 1] = SKP_SAT16(SKP_RSHIFT32(SKP_SMLAWB(256, out32_1, notch[3]), 9));
    }

    return out;
}

function invRatioQ16(inRate: number, outRate: number): number {
    // Equivalent to the C setup path for these downsample ratios: ceil(Fs_in / Fs_out * 2^16).
    return Math.ceil((inRate * 65536) / outRate) | 0;
}

function resampleDownFir(
    input: Int16Array,
    inRate: number,
    outRate: number,
    coefs: Int16Array,
    firFracs: number,
): Int16Array {
    if (input.length === 0) {
        return new Int16Array(0);
    }

    const orderFir = 12;
    const batchSize = Math.max(1, Math.floor(inRate / 100)); // 10 ms batches, same strategy as C
    const sIIR = new Int32Array(2);
    const sFIR = new Int32Array(orderFir);

    const fir = coefs.subarray(2);
    const indexIncrementQ16 = invRatioQ16(inRate, outRate);
    const outVals: number[] = [];

    let inPos = 0;
    while (inPos < input.length) {
        const n = Math.min(batchSize, input.length - inPos);
        const buf2 = new Int32Array(n + orderFir);
        buf2.set(sFIR, 0);

        SKP_Silk_resampler_private_AR2(sIIR, 0, buf2, orderFir, input, inPos, coefs, 0, n);

        const maxIndexQ16 = n * 65536;
        for (let indexQ16 = 0; indexQ16 < maxIndexQ16; indexQ16 += indexIncrementQ16) {
            const p = Math.floor(indexQ16 / 65536);
            let resQ6 = 0;

            if (firFracs === 1) {
                resQ6 = SKP_SMULWB((buf2[p + 0] + buf2[p + 11]) | 0, fir[0]);
                resQ6 = SKP_SMLAWB(resQ6, (buf2[p + 1] + buf2[p + 10]) | 0, fir[1]);
                resQ6 = SKP_SMLAWB(resQ6, (buf2[p + 2] + buf2[p + 9]) | 0, fir[2]);
                resQ6 = SKP_SMLAWB(resQ6, (buf2[p + 3] + buf2[p + 8]) | 0, fir[3]);
                resQ6 = SKP_SMLAWB(resQ6, (buf2[p + 4] + buf2[p + 7]) | 0, fir[4]);
                resQ6 = SKP_SMLAWB(resQ6, (buf2[p + 5] + buf2[p + 6]) | 0, fir[5]);
            } else {
                const fracPart = indexQ16 - p * 65536;
                const interpolInd = Math.floor((fracPart * firFracs) / 65536);
                const lo = interpolInd * 6;
                const hi = (firFracs - 1 - interpolInd) * 6;

                resQ6 = SKP_SMULWB(buf2[p + 0], fir[lo + 0]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 1], fir[lo + 1]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 2], fir[lo + 2]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 3], fir[lo + 3]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 4], fir[lo + 4]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 5], fir[lo + 5]);

                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 11], fir[hi + 0]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 10], fir[hi + 1]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 9], fir[hi + 2]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 8], fir[hi + 3]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 7], fir[hi + 4]);
                resQ6 = SKP_SMLAWB(resQ6, buf2[p + 6], fir[hi + 5]);
            }

            outVals.push(SKP_SAT16(SKP_RSHIFT_ROUND(resQ6, 6)));
        }

        sFIR.set(buf2.subarray(n, n + orderFir), 0);
        inPos += n;
    }

    const out = new Int16Array(outVals.length);
    for (let i = 0; i < outVals.length; i++) {
        out[i] = outVals[i] | 0;
    }
    return out;
}

export function resample(
    input: Int16Array,
    inRate: number,
    outRate: number
): Int16Array {
    if (inRate === outRate) {
        return new Int16Array(input);
    }

    // Prefer SILK fixed-point paths for core downsampling ratios used by encoder control.
    if ((inRate === 24000 && outRate === 12000) || (inRate === 16000 && outRate === 8000)) {
        return resampleDownFir(input, inRate, outRate, RESAMPLER_1_2_COEFS, 1);
    }
    if ((inRate === 24000 && outRate === 16000) || (inRate === 12000 && outRate === 8000)) {
        return resampleDownFir(input, inRate, outRate, RESAMPLER_2_3_COEFS, 2);
    }
    if (inRate === 16000 && outRate === 12000) {
        return resampleDownFir(input, inRate, outRate, RESAMPLER_3_4_COEFS, 3);
    }
    if (inRate === 24000 && outRate === 8000) {
        return resampleDownFir(input, inRate, outRate, RESAMPLER_1_3_COEFS, 1);
    }
    if (outRate === inRate * 2) {
        return resampleUp2Hq(input);
    }

    const ratio = outRate / inRate;
    const outLen = Math.round(input.length * ratio);
    const output = new Int16Array(outLen);

    if (ratio > 1) {
        // Upsample with linear interpolation
        for (let i = 0; i < outLen; i++) {
            const srcPos = i / ratio;
            const srcIdx = Math.floor(srcPos);
            const frac = srcPos - srcIdx;
            const s0 = input[Math.min(srcIdx, input.length - 1)];
            const s1 = input[Math.min(srcIdx + 1, input.length - 1)];
            output[i] = Math.round(s0 + frac * (s1 - s0));
        }
    } else {
        // Downsample with averaging
        for (let i = 0; i < outLen; i++) {
            const srcStart = i / ratio;
            const srcEnd = (i + 1) / ratio;
            const s0 = Math.floor(srcStart);
            const s1 = Math.min(Math.ceil(srcEnd), input.length);
            let sum = 0, count = 0;
            for (let j = s0; j < s1; j++) {
                sum += input[j]; count++;
            }
            output[i] = Math.round(sum / count);
        }
    }
    return output;
}
