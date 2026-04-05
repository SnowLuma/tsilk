/**
 * Range decoder operations
 */
import { RangeCoderState } from './range_coder';
import {
    RANGE_CODER_CDF_OUT_OF_RANGE,
    RANGE_CODER_NORMALIZATION_FAILED,
    RANGE_CODER_ZERO_INTERVAL_WIDTH,
    RANGE_CODER_DECODER_CHECK_FAILED,
} from './defines';
import { SKP_MUL_uint, SKP_Silk_CLZ32, toUint32 } from './macros';

/** Range decode one symbol. Returns decoded index. */
export function rangeDecode(
    psRC: RangeCoderState, prob: Uint16Array, probIx: number
): number {
    if (psRC.error) return 0;

    let base_Q32 = psRC.base_Q32 >>> 0;
    let range_Q16 = psRC.range_Q16 >>> 0;
    let bufferIx = psRC.bufferIx;
    // Decoder reads from buffer[4+]
    const bufOff = 4;

    let high_Q16 = prob[probIx];
    let base_tmp = SKP_MUL_uint(range_Q16, high_Q16);
    let low_Q16: number;

    if (base_tmp > base_Q32) {
        while (true) {
            low_Q16 = prob[--probIx];
            base_tmp = SKP_MUL_uint(range_Q16, low_Q16);
            if (base_tmp <= base_Q32) break;
            high_Q16 = low_Q16;
            if (high_Q16 === 0) {
                psRC.error = RANGE_CODER_CDF_OUT_OF_RANGE;
                return 0;
            }
        }
    } else {
        while (true) {
            low_Q16 = high_Q16;
            high_Q16 = prob[++probIx];
            base_tmp = SKP_MUL_uint(range_Q16, high_Q16);
            if (base_tmp > base_Q32) { probIx--; break; }
            if (high_Q16 === 0xFFFF) {
                psRC.error = RANGE_CODER_CDF_OUT_OF_RANGE;
                return 0;
            }
        }
    }

    const result = probIx;
    base_Q32 = toUint32(base_Q32 - SKP_MUL_uint(range_Q16, low_Q16));
    let range_Q32 = SKP_MUL_uint(range_Q16, high_Q16 - low_Q16);

    // Normalization
    if (range_Q32 & 0xFF000000) {
        range_Q16 = range_Q32 >>> 16;
    } else if (range_Q32 & 0xFFFF0000) {
        range_Q16 = range_Q32 >>> 8;
        if ((base_Q32 >>> 24) !== 0) {
            psRC.error = RANGE_CODER_NORMALIZATION_FAILED;
            return 0;
        }
    } else {
        range_Q16 = range_Q32;
        if ((base_Q32 >>> 16) !== 0) {
            psRC.error = RANGE_CODER_NORMALIZATION_FAILED;
            return 0;
        }
        base_Q32 = toUint32(base_Q32 << 8);
        if (bufferIx < psRC.bufferLength) {
            base_Q32 = toUint32(base_Q32 | psRC.buffer[bufOff + bufferIx++]);
        }
    }
    // Common path for 8-bit and 16-bit normalization
    if (!(range_Q32 & 0xFF000000)) {
        base_Q32 = toUint32(base_Q32 << 8);
        if (bufferIx < psRC.bufferLength) {
            base_Q32 = toUint32(base_Q32 | psRC.buffer[bufOff + bufferIx++]);
        }
    }

    if (range_Q16 === 0) {
        psRC.error = RANGE_CODER_ZERO_INTERVAL_WIDTH;
        return 0;
    }

    psRC.base_Q32 = base_Q32;
    psRC.range_Q16 = range_Q16;
    psRC.bufferIx = bufferIx;
    return result;
}

/** Decode multiple symbols */
export function rangeDecodeMulti(
    psRC: RangeCoderState,
    prob: Uint16Array[],
    probStartIx: number[],
    nSymbols: number
): number[] {
    const data: number[] = new Array(nSymbols);
    for (let k = 0; k < nSymbols; k++) {
        data[k] = rangeDecode(psRC, prob[k], probStartIx[k]);
    }
    return data;
}

/** Get bitstream length */
export function rangeCoderGetLength(psRC: RangeCoderState): { nBits: number; nBytes: number } {
    const nBits = (psRC.bufferIx << 3) + SKP_Silk_CLZ32((psRC.range_Q16 - 1) >>> 0) - 14;
    const nBytes = (nBits + 7) >> 3;
    return { nBits, nBytes };
}

/** Check remaining bits after decoding */
export function rangeCoderCheckAfterDecoding(psRC: RangeCoderState): void {
    const { nBits, nBytes } = rangeCoderGetLength(psRC);
    if (nBytes - 1 >= psRC.bufferLength) {
        psRC.error = RANGE_CODER_DECODER_CHECK_FAILED;
        console.log(`TS RC check fail: nBits=${nBits} nBytes=${nBytes} bufLen=${psRC.bufferLength} ix=${psRC.bufferIx}`);
        return;
    }
    if (nBits & 7) {
        const mask = 0xFF >> (nBits & 7);
        if ((psRC.buffer[nBytes - 1] & mask) !== mask) {
            psRC.error = RANGE_CODER_DECODER_CHECK_FAILED;
            console.log(
                `TS RC check fail: nBits=${nBits} nBytes=${nBytes} mask=${mask} last=${psRC.buffer[nBytes - 1]} ix=${psRC.bufferIx}`
            );
        }
    }
}
