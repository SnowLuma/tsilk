/**
 * Range encoder/decoder operations
 */
import { RangeCoderState } from './range_coder';
import {
    RANGE_CODER_WRITE_BEYOND_BUFFER,
    RANGE_CODER_CDF_OUT_OF_RANGE,
    RANGE_CODER_NORMALIZATION_FAILED,
    RANGE_CODER_ZERO_INTERVAL_WIDTH,
    RANGE_CODER_DECODER_CHECK_FAILED,
} from './defines';
import { SKP_MUL_uint, SKP_Silk_CLZ32, toUint32 } from './macros';

/** Range encode one symbol */
export function rangeEncode(
    psRC: RangeCoderState, data: number, prob: Uint16Array
): void {
    if (psRC.error) return;

    let base_Q32 = psRC.base_Q32 >>> 0;
    let range_Q16 = psRC.range_Q16 >>> 0;
    let bufferIx = psRC.bufferIx;

    const low_Q16 = prob[data];
    const high_Q16 = prob[data + 1];
    const base_tmp = base_Q32;
    base_Q32 = toUint32(base_Q32 + SKP_MUL_uint(range_Q16, low_Q16));
    let range_Q32 = SKP_MUL_uint(range_Q16, high_Q16 - low_Q16);

    // Carry propagation
    if (base_Q32 < base_tmp) {
        let ix = bufferIx;
        while ((++psRC.buffer[--ix]) === 0) { /* propagate */ }
    }

    if (range_Q32 & 0xFF000000) {
        range_Q16 = range_Q32 >>> 16;
    } else {
        if (range_Q32 & 0xFFFF0000) {
            range_Q16 = range_Q32 >>> 8;
        } else {
            range_Q16 = range_Q32;
            if (bufferIx >= psRC.bufferLength) {
                psRC.error = RANGE_CODER_WRITE_BEYOND_BUFFER; return;
            }
            psRC.buffer[bufferIx++] = (base_Q32 >>> 24) & 0xFF;
            base_Q32 = toUint32(base_Q32 << 8);
        }
        if (bufferIx >= psRC.bufferLength) {
            psRC.error = RANGE_CODER_WRITE_BEYOND_BUFFER; return;
        }
        psRC.buffer[bufferIx++] = (base_Q32 >>> 24) & 0xFF;
        base_Q32 = toUint32(base_Q32 << 8);
    }

    psRC.base_Q32 = base_Q32;
    psRC.range_Q16 = range_Q16;
    psRC.bufferIx = bufferIx;
}
